#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, ChildProcess } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

// Default paths for BootTidal.hs
const BOOT_TIDAL_PATHS = [
  join(homedir(), ".cabal/share/tidal-*/BootTidal.hs"),
  "/usr/share/tidal/BootTidal.hs",
  "/usr/local/share/tidal/BootTidal.hs",
  join(homedir(), ".local/share/tidal/BootTidal.hs"),
];

class TidalProcess {
  private process: ChildProcess | null = null;
  private errorBuffer: string = "";
  private outputBuffer: string = "";
  private bootTidalPath: string | null = null;
  private isReady: boolean = false;
  private readyPromise: Promise<void> | null = null;

  constructor(bootTidalPath?: string) {
    if (bootTidalPath) {
      this.bootTidalPath = bootTidalPath;
    } else {
      this.bootTidalPath = this.findBootTidal();
    }
  }

  private findBootTidal(): string | null {
    const { execSync } = require("child_process");
    for (const pattern of BOOT_TIDAL_PATHS) {
      try {
        const result = execSync(`ls ${pattern} 2>/dev/null`, { encoding: "utf-8" }).trim();
        if (result) {
          const paths = result.split("\n");
          if (paths.length > 0 && existsSync(paths[0])) {
            return paths[0];
          }
        }
      } catch {
        // Continue to next pattern
      }
    }
    return null;
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    return new Promise((resolve, reject) => {
      const args = ["--interactive"];
      if (this.bootTidalPath) {
        args.push("-ghci-script", this.bootTidalPath);
      }

      this.process = spawn("ghci", args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        this.outputBuffer += text;
        if (text.includes("tidal>") || text.includes("Prelude>")) {
          this.isReady = true;
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        this.errorBuffer += data.toString();
      });

      this.process.on("error", (err) => {
        reject(new Error(`Failed to start GHCi: ${err.message}`));
      });

      this.process.on("close", (code) => {
        this.process = null;
        this.isReady = false;
      });

      const startTime = Date.now();
      const checkReady = () => {
        if (this.isReady) {
          resolve();
        } else if (Date.now() - startTime > 30000) {
          reject(new Error("Tidal startup timeout. Make sure GHCi and Tidal are installed."));
        } else {
          setTimeout(checkReady, 100);
        }
      };
      setTimeout(checkReady, 500);
    });
  }

  async send(code: string): Promise<{ success: boolean; error?: string; output?: string }> {
    if (!this.process || !this.isReady) {
      await this.start();
    }

    return new Promise((resolve) => {
      this.errorBuffer = "";
      this.outputBuffer = "";

      this.process!.stdin?.write(code + "\n");

      setTimeout(() => {
        const error = this.parseError(this.errorBuffer);
        if (error) {
          resolve({ success: false, error });
        } else {
          resolve({ success: true, output: this.outputBuffer.trim() });
        }
      }, 200);
    });
  }

  private parseError(stderr: string): string | null {
    const errorPatterns = [
      /error:[\s\S]*?(?=\n\n|\n[^\s]|$)/gi,
      /parse error[\s\S]*?(?=\n\n|\n[^\s]|$)/gi,
      /not in scope[\s\S]*?(?=\n\n|\n[^\s]|$)/gi,
      /couldn't match[\s\S]*?(?=\n\n|\n[^\s]|$)/gi,
    ];

    for (const pattern of errorPatterns) {
      const match = stderr.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }

    if (stderr.includes("error") || stderr.includes("Error") || stderr.includes("exception")) {
      return stderr.trim();
    }

    return null;
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.stdin?.write(":quit\n");
      this.process.kill();
      this.process = null;
      this.isReady = false;
    }
  }
}

let tidal: TidalProcess | null = null;

async function getTidal(): Promise<TidalProcess> {
  if (!tidal) {
    tidal = new TidalProcess();
    await tidal.start();
  }
  return tidal;
}

// Helper for channel validation
function validateChannel(channel: unknown): { valid: boolean; error?: string; num?: number } {
  const num = Number(channel);
  if (isNaN(num) || num < 1 || num > 16) {
    return { valid: false, error: "Channel must be between 1 and 16" };
  }
  return { valid: true, num };
}

// Helper for tool error responses
function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// Helper for tool success responses
function successResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
  };
}

const server = new Server(
  {
    name: "tidal-cycles-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "send_pattern",
        description: "Send a TidalCycles pattern to a specific channel (d1-d16). The pattern will be evaluated by Tidal and played through SuperDirt.",
        inputSchema: {
          type: "object",
          properties: {
            channel: {
              type: "number",
              description: "Channel number (1-16, corresponds to d1-d16)",
              minimum: 1,
              maximum: 16,
            },
            pattern: {
              type: "string",
              description: "TidalCycles pattern expression (e.g., 'sound \"bd sn\"' or 's \"bd*4\" # gain 0.8')",
            },
          },
          required: ["channel", "pattern"],
        },
      },
      {
        name: "silence",
        description: "Silence one or all TidalCycles channels (hush)",
        inputSchema: {
          type: "object",
          properties: {
            channel: {
              type: "number",
              description: "Channel number to silence (1-16). If omitted, silences all channels (hush).",
              minimum: 1,
              maximum: 16,
            },
          },
          required: [],
        },
      },
      {
        name: "set_tempo",
        description: "Set the tempo in cycles per second (cps). Default Tidal tempo is 0.5625 cps (135 BPM). Formula: cps = bpm / 60 / 4",
        inputSchema: {
          type: "object",
          properties: {
            cps: {
              type: "number",
              description: "Cycles per second (e.g., 0.5 for 120 BPM, 1 for 240 BPM)",
              minimum: 0.01,
            },
          },
          required: ["cps"],
        },
      },
      {
        name: "solo",
        description: "Solo or unsolo a channel. When soloed, only that channel plays.",
        inputSchema: {
          type: "object",
          properties: {
            channel: {
              type: "number",
              description: "Channel number (1-16)",
              minimum: 1,
              maximum: 16,
            },
            enable: {
              type: "boolean",
              description: "True to solo, false to unsolo",
            },
          },
          required: ["channel", "enable"],
        },
      },
      {
        name: "mute",
        description: "Mute or unmute a channel",
        inputSchema: {
          type: "object",
          properties: {
            channel: {
              type: "number",
              description: "Channel number (1-16)",
              minimum: 1,
              maximum: 16,
            },
            enable: {
              type: "boolean",
              description: "True to mute, false to unmute",
            },
          },
          required: ["channel", "enable"],
        },
      },
      {
        name: "transition",
        description: "Transition to a new pattern using various transition effects",
        inputSchema: {
          type: "object",
          properties: {
            channel: {
              type: "number",
              description: "Channel number (1-16)",
              minimum: 1,
              maximum: 16,
            },
            pattern: {
              type: "string",
              description: "TidalCycles pattern expression to transition to",
            },
            type: {
              type: "string",
              enum: ["xfade", "clutch", "anticipate", "jump", "jumpIn", "jumpMod"],
              description: "Transition type: xfade (crossfade), clutch (degrade/undegrade), anticipate (build-up), jump (immediate), jumpIn (wait n cycles), jumpMod (wait for cycle mod n)",
            },
            cycles: {
              type: "number",
              description: "Number of cycles for the transition (for xfadeIn, clutchIn, jumpIn, jumpMod). Default varies by transition type.",
              minimum: 0,
            },
          },
          required: ["channel", "pattern", "type"],
        },
      },
      {
        name: "once",
        description: "Play a pattern exactly once (one-shot)",
        inputSchema: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "TidalCycles pattern expression to play once",
            },
          },
          required: ["pattern"],
        },
      },
      {
        name: "panic",
        description: "Send MIDI panic (all notes off) to stop stuck MIDI notes",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "reset_cycles",
        description: "Reset the cycle count to zero",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "tidal_code",
        description: "Execute arbitrary TidalCycles/Haskell code in the Tidal REPL. Use for advanced operations not covered by other tools.",
        inputSchema: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "TidalCycles or Haskell code to execute",
            },
          },
          required: ["code"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tidalInstance = await getTidal();
  const args = request.params.arguments ?? {};

  switch (request.params.name) {
    case "send_pattern": {
      const channelResult = validateChannel(args.channel);
      if (!channelResult.valid) return errorResponse(channelResult.error!);

      const pattern = String(args.pattern ?? "");
      if (!pattern) return errorResponse("Pattern is required");

      const code = `d${channelResult.num} $ ${pattern}`;
      const result = await tidalInstance.send(code);

      if (result.success) {
        return successResponse(`Playing on d${channelResult.num}: ${pattern}`);
      }
      return errorResponse(result.error!);
    }

    case "silence": {
      const channel = args.channel as number | undefined;

      if (channel !== undefined) {
        const channelResult = validateChannel(channel);
        if (!channelResult.valid) return errorResponse(channelResult.error!);

        const result = await tidalInstance.send(`d${channelResult.num} silence`);
        if (result.success) {
          return successResponse(`Silenced channel d${channelResult.num}`);
        }
        return errorResponse(result.error!);
      }

      const result = await tidalInstance.send("hush");
      if (result.success) {
        return successResponse("Silenced all channels");
      }
      return errorResponse(result.error!);
    }

    case "set_tempo": {
      const cps = Number(args.cps);
      if (isNaN(cps) || cps <= 0) {
        return errorResponse("CPS must be a positive number");
      }

      const result = await tidalInstance.send(`setcps ${cps}`);
      if (result.success) {
        const bpm = Math.round(cps * 60 * 4);
        return successResponse(`Tempo set to ${cps} cps (~${bpm} BPM)`);
      }
      return errorResponse(result.error!);
    }

    case "solo": {
      const channelResult = validateChannel(args.channel);
      if (!channelResult.valid) return errorResponse(channelResult.error!);

      const enable = Boolean(args.enable);
      const cmd = enable ? "solo" : "unsolo";

      const result = await tidalInstance.send(`${cmd} ${channelResult.num}`);
      if (result.success) {
        return successResponse(`${enable ? "Soloed" : "Unsoloed"} channel d${channelResult.num}`);
      }
      return errorResponse(result.error!);
    }

    case "mute": {
      const channelResult = validateChannel(args.channel);
      if (!channelResult.valid) return errorResponse(channelResult.error!);

      const enable = Boolean(args.enable);
      const cmd = enable ? "mute" : "unmute";

      const result = await tidalInstance.send(`${cmd} ${channelResult.num}`);
      if (result.success) {
        return successResponse(`${enable ? "Muted" : "Unmuted"} channel d${channelResult.num}`);
      }
      return errorResponse(result.error!);
    }

    case "transition": {
      const channelResult = validateChannel(args.channel);
      if (!channelResult.valid) return errorResponse(channelResult.error!);

      const pattern = String(args.pattern ?? "");
      if (!pattern) return errorResponse("Pattern is required");

      const type = String(args.type ?? "xfade");
      const cycles = args.cycles as number | undefined;

      let code: string;
      const validTransitions = ["xfade", "clutch", "anticipate", "jump", "jumpIn", "jumpMod"];

      if (!validTransitions.includes(type)) {
        return errorResponse(`Invalid transition type. Must be one of: ${validTransitions.join(", ")}`);
      }

      // Build transition command
      if (cycles !== undefined && ["xfade", "clutch", "jumpIn", "jumpMod"].includes(type)) {
        // Use the "In" variant for timed transitions
        const timedType = type === "xfade" ? "xfadeIn" :
                          type === "clutch" ? "clutchIn" : type;
        code = `${timedType} ${channelResult.num} ${cycles} $ ${pattern}`;
      } else if (type === "jumpIn" || type === "jumpMod") {
        // These require a cycle count
        const defaultCycles = type === "jumpIn" ? 1 : 4;
        code = `${type} ${channelResult.num} ${cycles ?? defaultCycles} $ ${pattern}`;
      } else {
        code = `${type} ${channelResult.num} $ ${pattern}`;
      }

      const result = await tidalInstance.send(code);
      if (result.success) {
        const cycleInfo = cycles !== undefined ? ` over ${cycles} cycles` : "";
        return successResponse(`Transitioning d${channelResult.num} with ${type}${cycleInfo}: ${pattern}`);
      }
      return errorResponse(result.error!);
    }

    case "once": {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return errorResponse("Pattern is required");

      const result = await tidalInstance.send(`once $ ${pattern}`);
      if (result.success) {
        return successResponse(`Playing once: ${pattern}`);
      }
      return errorResponse(result.error!);
    }

    case "panic": {
      const result = await tidalInstance.send("panic");
      if (result.success) {
        return successResponse("MIDI panic sent - all notes off");
      }
      return errorResponse(result.error!);
    }

    case "reset_cycles": {
      const result = await tidalInstance.send("resetCycles");
      if (result.success) {
        return successResponse("Cycle count reset to 0");
      }
      return errorResponse(result.error!);
    }

    case "tidal_code": {
      const code = String(args.code ?? "");
      if (!code) return errorResponse("Code is required");

      const result = await tidalInstance.send(code);
      if (result.success) {
        const output = result.output ? `Output: ${result.output}` : "Code executed successfully";
        return successResponse(output);
      }
      return errorResponse(result.error!);
    }

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    if (tidal) await tidal.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    if (tidal) await tidal.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
