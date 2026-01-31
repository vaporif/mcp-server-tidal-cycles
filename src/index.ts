#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { TidalProcess } from "./tidal.js";
import { AudioAnalyzer } from "./analyzer.js";
import { TIDAL_DOCS, RESOURCE_LIST } from "./resources.js";

function validateChannel(channel: unknown): { valid: boolean; error?: string; num?: number } {
  const num = Number(channel);
  if (isNaN(num) || num < 1 || num > 16) {
    return { valid: false, error: "Channel must be between 1 and 16" };
  }
  return { valid: true, num };
}

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function successResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
  };
}

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function max(arr: number[]): number {
  return arr.length > 0 ? Math.max(...arr) : 0;
}

const TOOL_DEFINITIONS = [
  {
    name: "send_pattern",
    description: "Send a TidalCycles pattern to a specific channel (d1-d16). The pattern will be evaluated by Tidal and played through SuperDirt.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "number", description: "Channel number (1-16, corresponds to d1-d16)", minimum: 1, maximum: 16 },
        pattern: { type: "string", description: "TidalCycles pattern expression (e.g., 'sound \"bd sn\"' or 's \"bd*4\" # gain 0.8')" },
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
        channel: { type: "number", description: "Channel number to silence (1-16). If omitted, silences all channels (hush).", minimum: 1, maximum: 16 },
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
        cps: { type: "number", description: "Cycles per second (e.g., 0.5 for 120 BPM, 1 for 240 BPM)", minimum: 0.01 },
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
        channel: { type: "number", description: "Channel number (1-16)", minimum: 1, maximum: 16 },
        enable: { type: "boolean", description: "True to solo, false to unsolo" },
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
        channel: { type: "number", description: "Channel number (1-16)", minimum: 1, maximum: 16 },
        enable: { type: "boolean", description: "True to mute, false to unmute" },
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
        channel: { type: "number", description: "Channel number (1-16)", minimum: 1, maximum: 16 },
        pattern: { type: "string", description: "TidalCycles pattern expression to transition to" },
        type: {
          type: "string",
          enum: ["xfade", "clutch", "anticipate", "jump", "jumpIn", "jumpMod"],
          description: "Transition type",
        },
        cycles: { type: "number", description: "Number of cycles for the transition", minimum: 0 },
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
        pattern: { type: "string", description: "TidalCycles pattern expression to play once" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "panic",
    description: "Send MIDI panic (all notes off) to stop stuck MIDI notes",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "reset_cycles",
    description: "Reset the cycle count to zero",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "analyze",
    description: "Analyze audio output for N seconds. Returns amplitude, spectral centroid (brightness), flatness (noisiness), and onset count. Requires SuperCollider analysis setup (see tidal://docs/supercollider-analysis resource).",
    inputSchema: {
      type: "object",
      properties: {
        duration: { type: "number", description: "Duration in seconds to analyze (default: 5)", minimum: 1, maximum: 30 },
      },
      required: [],
    },
  },
  {
    name: "tidal_code",
    description: "Execute arbitrary TidalCycles/Haskell code in the Tidal REPL. Use for advanced operations not covered by other tools.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "TidalCycles or Haskell code to execute" },
      },
      required: ["code"],
    },
  },
];

const PROMPTS = {
  create_beat: {
    name: "create_beat",
    description: "Help create a drum beat pattern",
    arguments: [
      { name: "style", description: "Style of beat (e.g., 'techno', 'hip-hop', 'ambient')", required: false },
      { name: "tempo", description: "Desired tempo in BPM", required: false },
    ],
  },
  create_ambient: {
    name: "create_ambient",
    description: "Create an ambient/drone soundscape",
    arguments: [
      { name: "mood", description: "Mood (e.g., 'dark', 'peaceful', 'spacey')", required: false },
    ],
  },
  live_session: {
    name: "live_session",
    description: "Start an interactive live coding session with guidance",
    arguments: [],
  },
  explain_pattern: {
    name: "explain_pattern",
    description: "Explain what a TidalCycles pattern does",
    arguments: [
      { name: "pattern", description: "The pattern code to explain", required: true },
    ],
  },
};

function getPromptMessages(promptName: string, args: Record<string, string>) {
  switch (promptName) {
    case "create_beat": {
      const style = args.style || "electronic";
      const tempo = args.tempo || "120";
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Create a ${style} drum beat at ${tempo} BPM using TidalCycles.

Read the mini-notation reference (tidal://docs/mini-notation) and samples list (tidal://docs/samples) first.

Use the send_pattern tool to play patterns. Use multiple channels (d1, d2, d3) for different drum elements.

Start simple and layer up. Set the tempo first with set_tempo.`,
          },
        }],
      };
    }

    case "create_ambient": {
      const mood = args.mood || "spacey";
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Create a ${mood} ambient soundscape using TidalCycles.

Read the effects reference (tidal://docs/effects) for reverb, delay, and filter settings.

Use slow-moving patterns, long samples (pad, ambient, space), heavy reverb (room, size), and subtle filter modulation.

Use the send_pattern tool. Keep tempo slow (try 0.25 cps or lower).`,
          },
        }],
      };
    }

    case "live_session": {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Let's have an interactive TidalCycles live coding session!

First, read all the documentation resources to understand patterns, samples, and effects.

Then start with a simple pattern on d1 and gradually build up. Ask me what style or mood I want, then create patterns accordingly.

Be ready to:
- Add/remove layers on different channels
- Apply effects and transitions
- Respond to my feedback to evolve the music
- Use transitions (xfade, clutch) to smoothly change patterns
- Use the analyze tool to check audio characteristics and adjust accordingly

Start by asking what kind of music I'd like to create.`,
          },
        }],
      };
    }

    case "explain_pattern": {
      const pattern = args.pattern || "";
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Explain what this TidalCycles pattern does:

\`\`\`haskell
${pattern}
\`\`\`

Break down:
1. The sound/sample being used
2. The rhythm structure (mini-notation)
3. Any effects applied
4. What it will sound like

Reference the mini-notation docs (tidal://docs/mini-notation) if needed.`,
          },
        }],
      };
    }

    default:
      throw new Error(`Unknown prompt: ${promptName}`);
  }
}

let tidal: TidalProcess | null = null;
let analyzer: AudioAnalyzer | null = null;

async function getTidal(): Promise<TidalProcess> {
  if (!tidal) {
    tidal = new TidalProcess();
    await tidal.start();
  }
  return tidal;
}

function getAnalyzer(): AudioAnalyzer {
  if (!analyzer) {
    analyzer = new AudioAnalyzer();
  }
  return analyzer;
}

const server = new Server(
  { name: "tidal-cycles-mcp", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: RESOURCE_LIST,
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const docName = url.pathname.replace(/^\//, "");
  const content = TIDAL_DOCS[docName];

  if (!content) {
    throw new Error(`Unknown resource: ${request.params.uri}`);
  }

  return {
    contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: content }],
  };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: Object.values(PROMPTS),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  return getPromptMessages(request.params.name, request.params.arguments ?? {});
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tidalInstance = await getTidal();
  const args = request.params.arguments ?? {};

  switch (request.params.name) {
    case "send_pattern": {
      const channelResult = validateChannel(args.channel);
      if (!channelResult.valid) return errorResponse(channelResult.error!);

      const pattern = String(args.pattern ?? "");
      if (!pattern) return errorResponse("Pattern is required");

      const result = await tidalInstance.send(`d${channelResult.num} $ ${pattern}`);
      return result.success
        ? successResponse(`Playing on d${channelResult.num}: ${pattern}`)
        : errorResponse(result.error!);
    }

    case "silence": {
      const channel = args.channel as number | undefined;

      if (channel !== undefined) {
        const channelResult = validateChannel(channel);
        if (!channelResult.valid) return errorResponse(channelResult.error!);

        const result = await tidalInstance.send(`d${channelResult.num} silence`);
        return result.success
          ? successResponse(`Silenced channel d${channelResult.num}`)
          : errorResponse(result.error!);
      }

      const result = await tidalInstance.send("hush");
      return result.success ? successResponse("Silenced all channels") : errorResponse(result.error!);
    }

    case "set_tempo": {
      const cps = Number(args.cps);
      if (isNaN(cps) || cps <= 0) return errorResponse("CPS must be a positive number");

      const result = await tidalInstance.send(`setcps ${cps}`);
      const bpm = Math.round(cps * 60 * 4);
      return result.success
        ? successResponse(`Tempo set to ${cps} cps (~${bpm} BPM)`)
        : errorResponse(result.error!);
    }

    case "solo": {
      const channelResult = validateChannel(args.channel);
      if (!channelResult.valid) return errorResponse(channelResult.error!);

      const enable = Boolean(args.enable);
      const result = await tidalInstance.send(`${enable ? "solo" : "unsolo"} ${channelResult.num}`);
      return result.success
        ? successResponse(`${enable ? "Soloed" : "Unsoloed"} channel d${channelResult.num}`)
        : errorResponse(result.error!);
    }

    case "mute": {
      const channelResult = validateChannel(args.channel);
      if (!channelResult.valid) return errorResponse(channelResult.error!);

      const enable = Boolean(args.enable);
      const result = await tidalInstance.send(`${enable ? "mute" : "unmute"} ${channelResult.num}`);
      return result.success
        ? successResponse(`${enable ? "Muted" : "Unmuted"} channel d${channelResult.num}`)
        : errorResponse(result.error!);
    }

    case "transition": {
      const channelResult = validateChannel(args.channel);
      if (!channelResult.valid) return errorResponse(channelResult.error!);

      const pattern = String(args.pattern ?? "");
      if (!pattern) return errorResponse("Pattern is required");

      const type = String(args.type ?? "xfade");
      const cycles = args.cycles as number | undefined;
      const validTransitions = ["xfade", "clutch", "anticipate", "jump", "jumpIn", "jumpMod"];

      if (!validTransitions.includes(type)) {
        return errorResponse(`Invalid transition type. Must be one of: ${validTransitions.join(", ")}`);
      }

      let code: string;
      if (cycles !== undefined && ["xfade", "clutch", "jumpIn", "jumpMod"].includes(type)) {
        const timedType = type === "xfade" ? "xfadeIn" : type === "clutch" ? "clutchIn" : type;
        code = `${timedType} ${channelResult.num} ${cycles} $ ${pattern}`;
      } else if (type === "jumpIn" || type === "jumpMod") {
        code = `${type} ${channelResult.num} ${cycles ?? (type === "jumpIn" ? 1 : 4)} $ ${pattern}`;
      } else {
        code = `${type} ${channelResult.num} $ ${pattern}`;
      }

      const result = await tidalInstance.send(code);
      const cycleInfo = cycles !== undefined ? ` over ${cycles} cycles` : "";
      return result.success
        ? successResponse(`Transitioning d${channelResult.num} with ${type}${cycleInfo}: ${pattern}`)
        : errorResponse(result.error!);
    }

    case "once": {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return errorResponse("Pattern is required");

      const result = await tidalInstance.send(`once $ ${pattern}`);
      return result.success ? successResponse(`Playing once: ${pattern}`) : errorResponse(result.error!);
    }

    case "panic": {
      const result = await tidalInstance.send("panic");
      return result.success ? successResponse("MIDI panic sent - all notes off") : errorResponse(result.error!);
    }

    case "reset_cycles": {
      const result = await tidalInstance.send("resetCycles");
      return result.success ? successResponse("Cycle count reset to 0") : errorResponse(result.error!);
    }

    case "analyze": {
      const duration = Number(args.duration) || 5;

      try {
        const audioAnalyzer = getAnalyzer();
        const data = await audioAnalyzer.analyze(duration);

        const avgAmp = avg(data.amplitude);
        const maxAmp = max(data.amplitude);
        const avgCentroid = avg(data.centroid);
        const avgFlatness = avg(data.flatness);
        const avgRms = avg(data.rms);

        const brightness = avgCentroid < 1000 ? "dark/bassy" :
                          avgCentroid < 3000 ? "balanced" :
                          avgCentroid < 6000 ? "bright" : "very bright/harsh";

        const noisiness = avgFlatness < 0.2 ? "tonal/melodic" :
                         avgFlatness < 0.5 ? "mixed" : "noisy/percussive";

        const summary = `Audio Analysis (${duration}s):
- Amplitude: avg ${avgAmp.toFixed(3)}, peak ${maxAmp.toFixed(3)}
- RMS Level: ${avgRms.toFixed(3)}
- Spectral Centroid: ${avgCentroid.toFixed(0)} Hz (${brightness})
- Spectral Flatness: ${avgFlatness.toFixed(3)} (${noisiness})
- Onsets Detected: ${data.onsets}
- Samples Collected: ${data.amplitude.length}`;

        return successResponse(summary);
      } catch (err) {
        return errorResponse(`Analysis failed: ${err}. Make sure SuperCollider is running with the analysis setup from tidal://docs/supercollider-analysis`);
      }
    }

    case "tidal_code": {
      const code = String(args.code ?? "");
      if (!code) return errorResponse("Code is required");

      const result = await tidalInstance.send(code);
      return result.success
        ? successResponse(result.output ? `Output: ${result.output}` : "Code executed successfully")
        : errorResponse(result.error!);
    }

    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const cleanup = async () => {
    if (tidal) await tidal.stop();
    if (analyzer) analyzer.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
