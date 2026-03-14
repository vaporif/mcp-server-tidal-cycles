# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TidalCycles MCP server that allows Claude to control TidalCycles live coding, with audio analysis feedback.

## Commands

```bash
cargo build            # Build
cargo build --release  # Release build
cargo clippy           # Lint
cargo fmt              # Format
```

## Prerequisites

- **GHCi** with TidalCycles installed
- **SuperCollider** with SuperDirt running
- For audio analysis: run the SuperCollider setup from `tidal://docs/supercollider-analysis`

## Architecture

**Rust MCP server** using `rmcp` (server, transport-io), `tokio`, `rosc`:

- `src/main.rs` — Entry point, tracing, signal handling
- `src/server.rs` — TidalMcpServer with tool/prompt routing and resource handling
- `src/errors.rs` — Error types with thiserror
- `src/tidal.rs` — GHCi subprocess management (start, send, stop, auto-restart)
- `src/analyzer.rs` — OSC audio analysis via rosc + tokio UDP
- `src/resources.rs` — Embedded docs via include_str!()
- `src/tools.rs` + `src/tools/` — Tool implementations (patterns, control, analysis)

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

## Configuration

Add to Claude Desktop config:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tidal-cycles": {
      "command": "/path/to/mcp-server-tidal-cycles"
    }
  }
}
```
