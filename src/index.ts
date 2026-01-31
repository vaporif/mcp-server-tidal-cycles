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
import { spawn, ChildProcess } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { Server as OSCServer, Client as OSCClient } from "node-osc";

// ============================================================================
// TidalCycles Documentation Resources
// ============================================================================

const TIDAL_DOCS: Record<string, string> = {
  "mini-notation": `# TidalCycles Mini-Notation

The mini-notation is a shorthand for writing patterns in TidalCycles.

## Basic Elements
- \`bd\` - a single bass drum
- \`bd sd\` - bass drum then snare (evenly spaced in cycle)
- \`bd*4\` - repeat 4 times
- \`bd/2\` - play every 2 cycles
- \`[bd sd]\` - group (play both in same time as one element)
- \`bd <sd cp>\` - alternating: sd first cycle, cp second cycle
- \`bd?\` - 50% chance of playing
- \`bd?0.25\` - 25% chance of playing
- \`bd!3\` - replicate 3 times (same as bd bd bd)
- \`bd@3\` - stretch over 3 steps
- \`bd _\` - rest/silence for that step

## Euclidean Rhythms
- \`bd(3,8)\` - 3 hits spread over 8 steps (euclidean)
- \`bd(3,8,2)\` - same with rotation of 2

## Sample Selection
- \`bd:2\` - third sample in bd folder (0-indexed)
- \`bd:0 bd:1 bd:2\` - different kicks

## Speed/Pitch
- Pattern with speed: \`sound "bd*4" # speed "1 2 0.5"\`
- Negative speed reverses sample

## Combining Patterns
- \`stack [pat1, pat2]\` - layer patterns
- \`cat [pat1, pat2]\` - sequence patterns

## Examples
\`\`\`haskell
sound "bd sd:2 [~ bd] sd"
sound "bd*4" # gain "1 0.8 0.6 0.8"
sound "arpy*8" # speed (range 0.5 2 sine)
sound "drum(5,8)" # n (irand 8)
\`\`\`
`,

  samples: `# SuperDirt Default Samples

## Drums
- \`bd\` - bass drums (24 variations)
- \`sd\` - snare drums
- \`hh\` - hi-hats (closed)
- \`oh\` or \`ho\` - open hi-hats
- \`cp\` - claps
- \`cr\` - crash cymbals
- \`rd\` - ride cymbals
- \`sn\` - more snares
- \`drum\` - acoustic drum kit
- \`drumtraks\` - drum machine sounds
- \`tabla\`, \`tabla2\` - tabla drums

## Bass
- \`bass\`, \`bass0\`, \`bass1\`, \`bass2\`, \`bass3\`
- \`db\` - double bass
- \`wobble\` - wobble bass

## Synths/Keys
- \`arpy\` - arpeggio synth notes
- \`superpiano\` - piano (use with n for notes)
- \`supersaw\` - saw synth
- \`supersquare\` - square wave
- \`superhammond\` - organ
- \`supervibe\` - vibraphone

## Melodic
- \`pluck\` - plucked strings
- \`gtr\` - guitar
- \`flick\` - various
- \`jvbass\` - synth bass

## Percussion
- \`can\` - cans
- \`metal\` - metallic hits
- \`bottle\` - bottles
- \`casio\` - casio keyboard

## Electronic
- \`glitch\`, \`glitch2\` - glitchy sounds
- \`noise\`, \`noise2\` - noise
- \`industrial\` - industrial sounds
- \`future\` - futuristic sounds

## Access variations
Use :n to select variation: \`bd:3\`, \`sd:1\`, \`arpy:4\`
`,

  effects: `# TidalCycles Effects & Controls

## Amplitude
- \`gain 0.8\` - volume (0 to 1+)
- \`amp 0.5\` - amplitude
- \`orbit 0\` - effects bus (0-11)

## Pitch/Speed
- \`speed 2\` - playback speed (2 = octave up, 0.5 = octave down)
- \`speed "-1"\` - reverse playback
- \`note 12\` - pitch shift in semitones
- \`n 0\` - select note/sample number

## Time
- \`begin 0.25\` - start point (0-1)
- \`end 0.75\` - end point (0-1)
- \`cut 1\` - cut group (stops other sounds in same group)
- \`legato 1\` - note length relative to pattern

## Filtering
- \`lpf 1000\` - low pass filter frequency
- \`hpf 500\` - high pass filter frequency
- \`bpf 1000\` - band pass filter
- \`resonance 0.5\` - filter resonance (0-1)
- \`vowel "a e i o u"\` - vowel formant filter

## Panning/Stereo
- \`pan 0.5\` - stereo position (0=left, 0.5=center, 1=right)

## Time Effects
- \`delay 0.5\` - delay wet (0-1)
- \`delaytime 0.25\` - delay time in cycles
- \`delayfeedback 0.5\` - delay feedback

## Reverb
- \`room 0.5\` - reverb room size (0-1)
- \`size 0.8\` - reverb size
- \`dry 1\` - dry signal level

## Distortion
- \`crush 4\` - bit crush (lower = more crushed)
- \`distort 0.5\` - distortion amount
- \`shape 0.5\` - wave shaping

## Combining Effects
Use # to combine: \`sound "bd" # gain 0.8 # lpf 800 # room 0.3\`
`,

  examples: `# TidalCycles Pattern Examples

## Basic Beats
\`\`\`haskell
-- Four on the floor
d1 $ sound "bd*4"

-- Basic rock beat
d1 $ sound "bd sd bd sd"

-- With hi-hats
d1 $ sound "[bd hh sd hh]*2"

-- Breakbeat style
d1 $ sound "bd [~ sd] bd [sd ~]"
\`\`\`

## Layered Patterns
\`\`\`haskell
-- Drums on d1, bass on d2
d1 $ sound "bd sd:2 [~ bd] sd"
d2 $ sound "bass:3*4" # gain 0.9

-- Stack in one channel
d1 $ stack [
  sound "bd sd bd sd",
  sound "hh*8" # gain 0.6,
  sound "~ cp ~ cp" # room 0.3
]
\`\`\`

## Melodic Patterns
\`\`\`haskell
-- Arpeggios
d1 $ sound "arpy*8" # n "0 2 4 7"

-- Random notes
d1 $ sound "arpy*8" # n (irand 12)
\`\`\`

## Effects Examples
\`\`\`haskell
-- Filter sweep
d1 $ sound "bass:3*4" # lpf (range 200 2000 sine) # resonance 0.3

-- Delay dub
d1 $ sound "sd:2*2" # delay 0.6 # delaytime 0.25 # delayfeedback 0.4

-- Reverb pad
d1 $ sound "pad:4" # room 0.8 # size 0.9
\`\`\`

## Transformations
\`\`\`haskell
-- Reverse every other cycle
d1 $ every 2 rev $ sound "arpy*8" # n "0 2 4 7 5 3 1 0"

-- Speed up
d1 $ fast 2 $ sound "bd sd bd sd"

-- Euclidean rhythms
d1 $ sound "bd(3,8)" # sound "sd(5,8,2)"
\`\`\`
`,

  "supercollider-analysis": `# SuperCollider Analysis Setup

Run this in SuperCollider to enable audio analysis for the MCP.

\`\`\`supercollider
(
// TidalCycles MCP Audio Analysis Setup
// Run this after SuperDirt is running

// Configuration
~mcpPort = 57130;  // Port MCP listens on
~analysisRate = 10; // Analysis updates per second

// Analysis synth - captures SuperDirt output
SynthDef(\\tidalAnalysis, {
    var in, fft, onsets, amp, centroid, flatness, rms;

    // Capture SuperDirt output (stereo mix)
    in = InFeedback.ar(0, 2).sum;

    // FFT analysis
    fft = FFT(LocalBuf(2048), in);

    // Audio features
    amp = Amplitude.kr(in, 0.01, 0.1);
    rms = RunningSum.rms(in, 1024);
    onsets = Onsets.kr(fft, 0.5, \\rcomplex);
    centroid = SpecCentroid.kr(fft);
    flatness = SpecFlatness.kr(fft);

    // Send to MCP via OSC
    SendReply.kr(Impulse.kr(~analysisRate), '/tidal/analysis', [
        amp,           // 0: amplitude (0-1)
        rms,           // 1: RMS level
        centroid,      // 2: spectral centroid (Hz) - brightness
        flatness,      // 3: spectral flatness (0-1) - noisiness
        onsets         // 4: onset detected (0 or 1)
    ]);
}).add;

// OSC responder to forward analysis to MCP
OSCdef(\\mcpAnalysis, { |msg|
    var data = msg[3..];
    NetAddr("127.0.0.1", ~mcpPort).sendMsg('/analysis/result',
        data[0], // amp
        data[1], // rms
        data[2], // centroid
        data[3], // flatness
        data[4]  // onsets
    );
}, '/tidal/analysis');

// Start/stop analysis
~startAnalysis = {
    ~analysisSynth = Synth(\\tidalAnalysis);
    "TidalCycles MCP Analysis started".postln;
};

~stopAnalysis = {
    ~analysisSynth.free;
    "TidalCycles MCP Analysis stopped".postln;
};

// OSC commands from MCP
OSCdef(\\mcpStartAnalysis, { |msg|
    var duration = msg[1] ? 5;
    ~startAnalysis.();

    // Auto-stop after duration
    SystemClock.sched(duration, {
        ~stopAnalysis.();
        NetAddr("127.0.0.1", ~mcpPort).sendMsg('/analysis/done');
        nil;
    });
}, '/tidal/startAnalysis');

OSCdef(\\mcpStopAnalysis, {
    ~stopAnalysis.();
}, '/tidal/stopAnalysis');

"TidalCycles MCP Analysis ready. Listening for commands on port 57120".postln;
"Analysis results sent to port ".post; ~mcpPort.postln;
)
\`\`\`

## Features Analyzed

| Feature | Range | Meaning |
|---------|-------|---------|
| amplitude | 0-1 | Overall loudness |
| rms | 0-1 | Root mean square level |
| centroid | Hz | Spectral brightness (higher = brighter) |
| flatness | 0-1 | Noisiness (1 = white noise, 0 = tonal) |
| onsets | 0/1 | Beat/transient detected |

## Usage from MCP

The \`analyze\` tool will:
1. Send OSC to SuperCollider to start analysis
2. Collect samples for the specified duration
3. Return aggregated statistics
`,
};

// ============================================================================
// Prompt Templates
// ============================================================================

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

// ============================================================================
// TidalProcess Class
// ============================================================================

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

  constructor(bootTidalPath?: string) {
    this.bootTidalPath = bootTidalPath ?? this.findBootTidal();
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
        continue;
      }
    }
    return null;
  }

  async start(): Promise<void> {
    if (this.process) return;

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

      this.process.on("close", () => {
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
      if (match) return match[0].trim();
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

// ============================================================================
// Audio Analysis via OSC
// ============================================================================

interface AnalysisData {
  amplitude: number[];
  rms: number[];
  centroid: number[];
  flatness: number[];
  onsets: number;
}

class AudioAnalyzer {
  private oscServer: OSCServer | null = null;
  private oscClient: OSCClient | null = null;
  private analysisData: AnalysisData | null = null;
  private analysisResolve: ((data: AnalysisData) => void) | null = null;
  private readonly localPort = 57130;
  private readonly scPort = 57120;

  async analyze(durationSeconds: number): Promise<AnalysisData> {
    return new Promise((resolve, reject) => {
      // Initialize data collection
      this.analysisData = {
        amplitude: [],
        rms: [],
        centroid: [],
        flatness: [],
        onsets: 0,
      };
      this.analysisResolve = resolve;

      // Start OSC server if not running
      if (!this.oscServer) {
        this.oscServer = new OSCServer(this.localPort, "127.0.0.1", () => {
          console.error(`OSC server listening on port ${this.localPort}`);
        });

        this.oscServer.on("message", (msg) => {
          const [address, ...args] = msg;

          if (address === "/analysis/result" && this.analysisData) {
            const [amp, rms, centroid, flatness, onset] = args as number[];
            this.analysisData.amplitude.push(amp);
            this.analysisData.rms.push(rms);
            this.analysisData.centroid.push(centroid);
            this.analysisData.flatness.push(flatness);
            if (onset > 0.5) this.analysisData.onsets++;
          }

          if (address === "/analysis/done" && this.analysisResolve && this.analysisData) {
            this.analysisResolve(this.analysisData);
            this.analysisResolve = null;
          }
        });

        this.oscServer.on("error", (err) => {
          console.error("OSC error:", err);
          reject(err);
        });
      }

      // Create OSC client to SuperCollider
      if (!this.oscClient) {
        this.oscClient = new OSCClient("127.0.0.1", this.scPort);
      }

      // Tell SuperCollider to start analysis
      this.oscClient.send("/tidal/startAnalysis", durationSeconds);

      // Timeout fallback
      setTimeout(() => {
        if (this.analysisResolve && this.analysisData) {
          this.analysisResolve(this.analysisData);
          this.analysisResolve = null;
        }
      }, (durationSeconds + 1) * 1000);
    });
  }

  close() {
    if (this.oscServer) {
      this.oscServer.close();
      this.oscServer = null;
    }
    if (this.oscClient) {
      this.oscClient.close();
      this.oscClient = null;
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  { name: "tidal-cycles-mcp", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// ============================================================================
// Resource Handlers
// ============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "tidal://docs/mini-notation",
        mimeType: "text/markdown",
        name: "Mini-Notation Reference",
        description: "TidalCycles mini-notation syntax for writing patterns",
      },
      {
        uri: "tidal://docs/samples",
        mimeType: "text/markdown",
        name: "Sample Library",
        description: "List of default SuperDirt samples and categories",
      },
      {
        uri: "tidal://docs/effects",
        mimeType: "text/markdown",
        name: "Effects Reference",
        description: "Available effects and controls (gain, lpf, delay, etc.)",
      },
      {
        uri: "tidal://docs/examples",
        mimeType: "text/markdown",
        name: "Pattern Examples",
        description: "Example patterns for beats, melodies, and effects",
      },
      {
        uri: "tidal://docs/supercollider-analysis",
        mimeType: "text/markdown",
        name: "SuperCollider Analysis Setup",
        description: "Code to enable audio analysis in SuperCollider for the analyze tool",
      },
    ],
  };
});

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

// ============================================================================
// Prompt Handlers
// ============================================================================

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return { prompts: Object.values(PROMPTS) };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const promptName = request.params.name;
  const args = request.params.arguments ?? {};

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
});

// ============================================================================
// Tool Handlers
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
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

        // Interpret the data
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

// ============================================================================
// Main
// ============================================================================

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
