export const TIDAL_DOCS: Record<string, string> = {
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

export const RESOURCE_LIST = [
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
];
