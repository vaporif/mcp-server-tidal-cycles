# mcp-server-tidal-cycles

MCP server for [TidalCycles](https://tidalcycles.org/) live coding with audio analysis feedback.

## Prerequisites

- **GHCi** with TidalCycles installed
- **SuperCollider** with SuperDirt running
- For audio analysis: run the SuperCollider setup from `tidal://docs/supercollider-analysis`

## Usage

### Claude Desktop / Claude Code

**With [uvx](https://docs.astral.sh/uv/):**

```json
{
  "mcpServers": {
    "tidal-cycles": {
      "command": "uvx",
      "args": ["mcp-server-tidal-cycles"]
    }
  }
}
```

**With [rvx](https://github.com/vaporif/rvx):**

```json
{
  "mcpServers": {
    "tidal-cycles": {
      "command": "rvx",
      "args": ["mcp-server-tidal-cycles"]
    }
  }
}
```

<details>
<summary>Other installation methods</summary>

**With Nix:**

```sh
nix run github:vaporif/tidal-cycles-mcp
```

**With cargo:**

```sh
cargo install mcp-server-tidal-cycles
```

**From releases:**

Download a prebuilt binary from [GitHub Releases](https://github.com/vaporif/tidal-cycles-mcp/releases).

</details>

### Debugging

```sh
RUST_LOG=debug mcp-server-tidal-cycles
```

## Tools

| Tool | Description |
|------|-------------|
| `send_pattern` | Send pattern to channel d1-d16 |
| `silence` | Silence one or all channels (hush) |
| `set_tempo` | Set tempo in cycles per second |
| `solo` | Solo/unsolo a channel |
| `mute` | Mute/unmute a channel |
| `transition` | Transition to pattern (xfade, clutch, anticipate, jump) |
| `once` | Play pattern once (one-shot) |
| `panic` | MIDI panic - all notes off |
| `reset_cycles` | Reset cycle count to 0 |
| `analyze` | Analyze audio for N seconds (amplitude, brightness, noisiness, onsets) |
| `tidal_code` | Execute arbitrary Tidal/Haskell code |

## Resources

| URI | Description |
|-----|-------------|
| `tidal://docs/mini-notation` | Pattern syntax reference |
| `tidal://docs/samples` | SuperDirt sample library |
| `tidal://docs/effects` | Effects and controls |
| `tidal://docs/examples` | Example patterns |
| `tidal://docs/supercollider-analysis` | SuperCollider setup for audio analysis |

## Prompts

| Prompt | Description |
|--------|-------------|
| `create_beat` | Help create drum patterns |
| `create_ambient` | Create ambient soundscapes |
| `live_session` | Interactive live coding session |
| `explain_pattern` | Explain a TidalCycles pattern |

## Development

```sh
nix develop  # or install Rust toolchain manually

just check   # clippy + test + fmt + taplo + typos
just fmt     # auto-format
just deny    # dependency audit
```

## License

MIT
