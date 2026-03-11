# TidalCycles Pattern Examples

## Basic Beats
```haskell
-- Four on the floor
d1 $ sound "bd*4"

-- Basic rock beat
d1 $ sound "bd sd bd sd"

-- With hi-hats
d1 $ sound "[bd hh sd hh]*2"

-- Breakbeat style
d1 $ sound "bd [~ sd] bd [sd ~]"
```

## Layered Patterns
```haskell
-- Drums on d1, bass on d2
d1 $ sound "bd sd:2 [~ bd] sd"
d2 $ sound "bass:3*4" # gain 0.9

-- Stack in one channel
d1 $ stack [
  sound "bd sd bd sd",
  sound "hh*8" # gain 0.6,
  sound "~ cp ~ cp" # room 0.3
]
```

## Melodic Patterns
```haskell
-- Arpeggios
d1 $ sound "arpy*8" # n "0 2 4 7"

-- Random notes
d1 $ sound "arpy*8" # n (irand 12)
```

## Effects Examples
```haskell
-- Filter sweep
d1 $ sound "bass:3*4" # lpf (range 200 2000 sine) # resonance 0.3

-- Delay dub
d1 $ sound "sd:2*2" # delay 0.6 # delaytime 0.25 # delayfeedback 0.4

-- Reverb pad
d1 $ sound "pad:4" # room 0.8 # size 0.9
```

## Transformations
```haskell
-- Reverse every other cycle
d1 $ every 2 rev $ sound "arpy*8" # n "0 2 4 7 5 3 1 0"

-- Speed up
d1 $ fast 2 $ sound "bd sd bd sd"

-- Euclidean rhythms
d1 $ sound "bd(3,8)" # sound "sd(5,8,2)"
```
