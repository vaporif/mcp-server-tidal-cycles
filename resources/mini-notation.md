# TidalCycles Mini-Notation

The mini-notation is a shorthand for writing patterns in TidalCycles.

## Basic Elements
- `bd` - a single bass drum
- `bd sd` - bass drum then snare (evenly spaced in cycle)
- `bd*4` - repeat 4 times
- `bd/2` - play every 2 cycles
- `[bd sd]` - group (play both in same time as one element)
- `bd <sd cp>` - alternating: sd first cycle, cp second cycle
- `bd?` - 50% chance of playing
- `bd?0.25` - 25% chance of playing
- `bd!3` - replicate 3 times (same as bd bd bd)
- `bd@3` - stretch over 3 steps
- `bd _` - rest/silence for that step

## Euclidean Rhythms
- `bd(3,8)` - 3 hits spread over 8 steps (euclidean)
- `bd(3,8,2)` - same with rotation of 2

## Sample Selection
- `bd:2` - third sample in bd folder (0-indexed)
- `bd:0 bd:1 bd:2` - different kicks

## Speed/Pitch
- Pattern with speed: `sound "bd*4" # speed "1 2 0.5"`
- Negative speed reverses sample

## Combining Patterns
- `stack [pat1, pat2]` - layer patterns
- `cat [pat1, pat2]` - sequence patterns

## Examples
```haskell
sound "bd sd:2 [~ bd] sd"
sound "bd*4" # gain "1 0.8 0.6 0.8"
sound "arpy*8" # speed (range 0.5 2 sine)
sound "drum(5,8)" # n (irand 8)
```
