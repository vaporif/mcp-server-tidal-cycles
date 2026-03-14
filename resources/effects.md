# TidalCycles Effects & Controls

## Amplitude
- `gain 0.8` - volume (0 to 1+)
- `amp 0.5` - amplitude
- `orbit 0` - effects bus (0-11)

## Pitch/Speed
- `speed 2` - playback speed (2 = octave up, 0.5 = octave down)
- `speed "-1"` - reverse playback
- `note 12` - pitch shift in semitones
- `n 0` - select note/sample number

## Time
- `begin 0.25` - start point (0-1)
- `end 0.75` - end point (0-1)
- `cut 1` - cut group (stops other sounds in same group)
- `legato 1` - note length relative to pattern

## Filtering
- `lpf 1000` - low pass filter frequency
- `hpf 500` - high pass filter frequency
- `bpf 1000` - band pass filter
- `resonance 0.5` - filter resonance (0-1)
- `vowel "a e i o u"` - vowel formant filter

## Panning/Stereo
- `pan 0.5` - stereo position (0=left, 0.5=center, 1=right)

## Time Effects
- `delay 0.5` - delay wet (0-1)
- `delaytime 0.25` - delay time in cycles
- `delayfeedback 0.5` - delay feedback

## Reverb
- `room 0.5` - reverb room size (0-1)
- `size 0.8` - reverb size
- `dry 1` - dry signal level

## Distortion
- `crush 4` - bit crush (lower = more crushed)
- `distort 0.5` - distortion amount
- `shape 0.5` - wave shaping

## Combining Effects
Use # to combine: `sound "bd" # gain 0.8 # lpf 800 # room 0.3`
