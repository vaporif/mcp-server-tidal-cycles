# SuperCollider Analysis Setup

Run this in SuperCollider to enable audio analysis for the MCP.

```supercollider
(
// TidalCycles MCP Audio Analysis Setup
// Run this after SuperDirt is running

// Configuration
~mcpPort = 57130;  // Port MCP listens on
~analysisRate = 10; // Analysis updates per second

// Analysis synth - captures SuperDirt output
SynthDef(\tidalAnalysis, {
    var in, fft, onsets, amp, centroid, flatness, rms;

    // Capture SuperDirt output (stereo mix)
    in = InFeedback.ar(0, 2).sum;

    // FFT analysis
    fft = FFT(LocalBuf(2048), in);

    // Audio features
    amp = Amplitude.kr(in, 0.01, 0.1);
    rms = RunningSum.rms(in, 1024);
    onsets = Onsets.kr(fft, 0.5, \rcomplex);
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
OSCdef(\mcpAnalysis, { |msg|
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
    ~analysisSynth = Synth(\tidalAnalysis);
    "TidalCycles MCP Analysis started".postln;
};

~stopAnalysis = {
    ~analysisSynth.free;
    "TidalCycles MCP Analysis stopped".postln;
};

// OSC commands from MCP
OSCdef(\mcpStartAnalysis, { |msg|
    var duration = msg[1] ? 5;
    ~startAnalysis.();

    // Auto-stop after duration
    SystemClock.sched(duration, {
        ~stopAnalysis.();
        NetAddr("127.0.0.1", ~mcpPort).sendMsg('/analysis/done');
        nil;
    });
}, '/tidal/startAnalysis');

OSCdef(\mcpStopAnalysis, {
    ~stopAnalysis.();
}, '/tidal/stopAnalysis');

"TidalCycles MCP Analysis ready. Listening for commands on port 57120".postln;
"Analysis results sent to port ".post; ~mcpPort.postln;
)
```

## Features Analyzed

| Feature | Range | Meaning |
|---------|-------|---------|
| amplitude | 0-1 | Overall loudness |
| rms | 0-1 | Root mean square level |
| centroid | Hz | Spectral brightness (higher = brighter) |
| flatness | 0-1 | Noisiness (1 = white noise, 0 = tonal) |
| onsets | 0/1 | Beat/transient detected |

## Usage from MCP

The `analyze` tool will:
1. Send OSC to SuperCollider to start analysis
2. Collect samples for the specified duration
3. Return aggregated statistics
