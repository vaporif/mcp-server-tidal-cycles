# mcp-server-tidal-cycles — Rust Rewrite Design

## Overview

Total rewrite of the TidalCycles MCP server from TypeScript to Rust, renamed to `mcp-server-tidal-cycles`. Mirrors the architecture of [wezterm-mcp](../../../wezterm-mcp) using `rmcp`, `tokio`, and `thiserror`. Feature parity with the existing TS implementation: 11 tools, 5 resources, 4 prompts.

## Motivation

- Single-binary distribution (no Node.js/Bun runtime dependency)
- Consistent with existing wezterm-mcp patterns
- Better subprocess and async I/O handling via tokio

## Project Structure

```
mcp-server-tidal-cycles/
├── Cargo.toml
├── flake.nix                    # Nix build with crane
├── resources/
│   ├── mini-notation.md         # Pattern syntax reference
│   ├── samples.md               # SuperDirt sample library
│   ├── effects.md               # Effects and controls
│   ├── examples.md              # Example patterns
│   └── supercollider-analysis.md # SuperCollider setup
└── src/
    ├── main.rs                  # Entry point, tracing, server startup
    ├── server.rs                # TidalMcpServer, #[tool_router], ServerHandler
    ├── errors.rs                # thiserror Error enum
    ├── tidal.rs                 # GHCi subprocess management
    ├── analyzer.rs              # OSC audio analysis via rosc + tokio UDP
    ├── resources.rs             # Embedded docs, resource/prompt definitions
    ├── tools.rs                 # Shared types (TransitionType, channel validation)
    └── tools/
        ├── patterns.rs          # send_pattern, silence, transition, once
        ├── control.rs           # set_tempo, solo, mute, panic, reset_cycles, tidal_code
        └── analysis.rs          # analyze tool
```

## Dependencies

| Crate | Version | Features | Purpose |
|-------|---------|----------|---------|
| rmcp | 1.2 | server, transport-io | MCP SDK with tool/prompt macros |
| tokio | 1 | rt-multi-thread, macros, process, net, sync, time | Async runtime |
| thiserror | 2 | — | Error types |
| serde | 1 | derive | Serialization |
| schemars | 1 | — | JSON Schema for tool params |
| rosc | latest | — | OSC encoding/decoding |
| tracing | 0.1 | — | Structured logging |
| tracing-subscriber | 0.3 | env-filter | Log output |
| glob | latest | — | BootTidal.hs discovery |

Clippy: pedantic + nursery enabled.

## Component Design

### 1. TidalProcess (src/tidal.rs)

Manages a long-lived GHCi subprocess with TidalCycles loaded.

**Struct**:
```rust
pub struct TidalProcess {
    stdin: ChildStdin,
    stdout_buffer: Arc<Mutex<String>>,
    stderr_buffer: Arc<Mutex<String>>,
    is_ready: bool,
    child: Child,
}
```

**BootTidal.hs discovery** — glob patterns searched in order:
1. `~/.cabal/share/tidal-*/BootTidal.hs`
2. `/usr/share/tidal/BootTidal.hs`
3. `/usr/local/share/tidal/BootTidal.hs`
4. `~/.local/share/tidal/BootTidal.hs`

**Lifecycle**:
- `start()` — Spawns `ghci --interactive -ghci-script <path>`. Background tokio tasks drain stdout/stderr into `Arc<Mutex<String>>` buffers. Polls for `"tidal>"` or `"Prelude>"` in stdout with 30s timeout (100ms poll interval).
- `send(code: &str) -> Result<TidalResponse>` — Clears both stdout/stderr buffers, writes `code\n` to stdin, waits ~200ms, reads stderr buffer, parses error patterns. Auto-restarts if process died.
- `stop()` — Sends `:quit\n`, kills child process.

**Error parsing** — regex patterns on stderr (with multiline extraction):
- `error:` (with lookahead to capture multiline error body)
- `parse error`
- `not in scope`
- `couldn't match`
- Fallback: generic check for `error`/`Error`/`exception` strings

**Response type**:
```rust
pub enum TidalResponse {
    Success { output: Option<String> },
    Error { message: String },
}
```

### 2. AudioAnalyzer (src/analyzer.rs)

Stateless per-call OSC communication with SuperCollider.

**Function**:
```rust
pub async fn analyze(duration_secs: u32) -> Result<AnalysisResult>
```

**Flow**:
1. Bind tokio `UdpSocket` on `127.0.0.1:57130`
2. Encode and send `/tidal/startAnalysis` with duration to `127.0.0.1:57120` via `rosc`
3. Receive loop: decode OSC packets
   - `/analysis/result` — extract `[amplitude, rms, centroid, flatness, onset]` as f32 values, accumulate amplitude/rms/centroid/flatness into `Vec<f32>`. Count onset if value > 0.5 (increment `onsets` counter).
   - `/analysis/done` — break
4. Timeout: `duration + 1` seconds via `tokio::time::timeout`

**Result type**:
```rust
pub struct AnalysisResult {
    pub amplitude: Vec<f32>,
    pub rms: Vec<f32>,
    pub centroid: Vec<f32>,
    pub flatness: Vec<f32>,
    pub onsets: u32,
}
```

**Summary method** on `AnalysisResult`:
- Avg/max amplitude and RMS
- Brightness: centroid < 1000 Hz = dark, < 3000 = balanced, < 6000 = bright, else very bright
- Noisiness: flatness < 0.2 = tonal, < 0.5 = mixed, else noisy/percussive
- Onset count

### 3. Server (src/server.rs)

**Struct**:
```rust
#[derive(Clone)]
pub struct TidalMcpServer {
    tidal: Arc<tokio::sync::Mutex<Option<TidalProcess>>>,
    tool_router: ToolRouter<Self>,
    prompt_router: PromptRouter<Self>,
}
```

Lazy-initializes TidalProcess on first tool call via a `get_or_init_tidal()` helper.

**Tool routing**: `#[tool_router]` on impl block, each tool is a `#[tool(description = "...")]` async method that delegates to functions in `tools/`.

**Prompt routing**: `#[prompt_router]` on a separate impl block, each prompt is a `#[prompt(description = "...")]` async method. Stack both `#[tool_handler]` and `#[prompt_handler]` on the `ServerHandler` impl:
```rust
#[tool_handler]
#[prompt_handler]
impl ServerHandler for TidalMcpServer {
    fn get_info(&self) -> ServerInfo { ... }
    // manual list_resources / read_resource here
}
```

**Resource handling**: Manually implement `list_resources` and `read_resource` on `ServerHandler` (rmcp does not have resource macros). Match on URI to return embedded markdown content.

**ServerCapabilities**: `get_info()` must advertise all three capabilities:
```rust
ServerCapabilities::builder()
    .enable_tools()
    .enable_prompts()
    .enable_resources()
    .build()
```

### 4. Tools (src/tools/)

**tools.rs** — shared types:
```rust
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TransitionType { Xfade, Clutch, Anticipate, Jump, JumpIn, JumpMod }

pub fn validate_channel(channel: u8) -> Result<()>  // 1-16
```

**tools/patterns.rs**:
| Function | Tidal Command |
|----------|--------------|
| `send_pattern(channel, pattern)` | `d{n} $ {pattern}` |
| `silence(channel?)` | `d{n} silence` or `hush` |
| `transition(channel, pattern, type, cycles?)` | See transition logic below |
| `once(pattern)` | `once $ {pattern}` |

**Transition logic** (branching based on type and cycles):
- `xfade`: without cycles → `xfade {n} $ {p}`, with cycles → `xfadeIn {n} {c} $ {p}`
- `clutch`: without cycles → `clutch {n} $ {p}`, with cycles → `clutchIn {n} {c} $ {p}`
- `anticipate`: `anticipate {n} $ {p}` (cycles ignored)
- `jump`: `jump {n} $ {p}` (cycles ignored)
- `jumpIn`: `jumpIn {n} {c} $ {p}` (cycles defaults to 1)
- `jumpMod`: `jumpMod {n} {c} $ {p}` (cycles defaults to 4)

**tools/control.rs**:
| Function | Tidal Command |
|----------|--------------|
| `set_tempo(cps)` | `setcps {cps}` (validates > 0) |
| `solo(channel, enable)` | `solo {n}` / `unsolo {n}` |
| `mute(channel, enable)` | `mute {n}` / `unmute {n}` |
| `panic()` | `panic` |
| `reset_cycles()` | `resetCycles` |
| `tidal_code(code)` | raw code passthrough |

**tools/analysis.rs**:
| Function | Behavior |
|----------|----------|
| `analyze(duration?)` | Defaults 5s, validates 1-30, calls `analyzer::analyze()`, formats summary |

All parameter structs derive `Deserialize + JsonSchema`.

### 5. Resources (src/resources.rs)

Five markdown files embedded at compile time:
```rust
const MINI_NOTATION: &str = include_str!("../resources/mini-notation.md");
const SAMPLES: &str = include_str!("../resources/samples.md");
const EFFECTS: &str = include_str!("../resources/effects.md");
const EXAMPLES: &str = include_str!("../resources/examples.md");
const SC_ANALYSIS: &str = include_str!("../resources/supercollider-analysis.md");
```

Resource URIs: `tidal://docs/mini-notation`, `tidal://docs/samples`, `tidal://docs/effects`, `tidal://docs/examples`, `tidal://docs/supercollider-analysis`.

### 6. Prompts (src/resources.rs)

Four prompts, same content as TS version:
| Prompt | Arguments |
|--------|-----------|
| `create_beat` | style, tempo |
| `create_ambient` | mood |
| `live_session` | (none) |
| `explain_pattern` | pattern |

Each returns structured messages with resource references guiding the LLM.

### 7. Error Handling (src/errors.rs)

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Tidal error: {0}")]
    Tidal(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("OSC error: {0}")]
    Osc(String),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Timeout: {0}")]
    Timeout(String),
}
```

Implements `From<Error> for rmcp::ErrorData` for MCP error propagation.

### 8. Entry Point (src/main.rs)

```rust
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let server = TidalMcpServer::new();
    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}
```

Graceful shutdown via `tokio::signal` handlers (SIGINT/SIGTERM) — calls `tidal.stop()` before exit. Cannot use `Drop` since it's synchronous and cannot acquire async mutex locks.

## Build & Distribution

**Nix flake**: crane-based Rust build (matching wezterm-mcp pattern). Dev shell includes Rust toolchain, cargo-nextest.

**Binary output**: `target/release/mcp-server-tidal-cycles`

**Claude Desktop config**:
```json
{
  "mcpServers": {
    "tidal-cycles": {
      "command": "/path/to/mcp-server-tidal-cycles"
    }
  }
}
```

## Feature Parity Checklist

- [x] 11 tools: send_pattern, silence, set_tempo, solo, mute, transition, once, panic, reset_cycles, analyze, tidal_code
- [x] 5 resources: mini-notation, samples, effects, examples, supercollider-analysis
- [x] 4 prompts: create_beat, create_ambient, live_session, explain_pattern
- [x] GHCi subprocess with auto-discovery, error parsing, auto-restart
- [x] OSC audio analysis with SuperCollider
- [x] Lazy initialization of TidalProcess
- [x] Graceful shutdown
