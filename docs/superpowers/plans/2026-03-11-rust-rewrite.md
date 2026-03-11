# mcp-server-tidal-cycles Rust Rewrite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the TidalCycles MCP server from TypeScript to Rust, rename to mcp-server-tidal-cycles, with full feature parity.

**Architecture:** rmcp-based MCP server with tokio async runtime. GHCi subprocess management via tokio::process with stdin/stdout piping. OSC audio analysis via rosc + tokio UDP sockets. Resources embedded at compile time with include_str!().

**Tech Stack:** Rust, rmcp 1.2 (server, transport-io), tokio, thiserror, rosc, serde, schemars, tracing, glob

**Spec:** `docs/superpowers/specs/2026-03-11-rust-rewrite-design.md`

**Reference project:** `../wezterm-mcp` (same rmcp patterns)

**Important rmcp 1.2 API notes:** The code snippets in Chunk 6 (server.rs) use approximate rmcp types. During compilation, fix these against the actual rmcp 1.2 API:
- `list_resources` takes `Option<PaginatedRequestParams>`, not `PaginatedRequest`
- `read_resource` takes `ReadResourceRequestParams`, not `ReadResourceRequest`
- `Resource` is `Annotated<RawResource>` — use builder: `RawResource::new(uri, name).with_description(...).with_mime_type(...).no_annotation()`
- Prompt messages use `PromptMessageRole::User` (not `Role::User`) and construct via `PromptMessage::new_text(role, text)`
- `ListResourcesResult` is `#[non_exhaustive]` — use `Default::default()` or builder
- `TidalProcess::send` must auto-restart if the process has died (check `is_running()` and call `start()` again)
- Check `../wezterm-mcp/src/server.rs` for working patterns when in doubt

---

## Chunk 1: Project Scaffold & Error Types

### Task 1: Initialize Rust project

**Files:**
- Create: `Cargo.toml`
- Create: `flake.nix`
- Create: `src/main.rs`
- Create: `src/errors.rs`
- Remove: `package.json`, `tsconfig.json`, `src/index.ts`, `src/tidal.ts`, `src/analyzer.ts`, `src/resources.ts`, `src/osc.d.ts`, `build/`

- [ ] **Step 1: Remove old TypeScript files**

```bash
rm -rf build/ src/index.ts src/tidal.ts src/analyzer.ts src/resources.ts src/osc.d.ts package.json tsconfig.json bun.lock node_modules/
```

- [ ] **Step 2: Create Cargo.toml**

Create `Cargo.toml`:

```toml
[package]
name = "mcp-server-tidal-cycles"
version = "0.1.0"
edition = "2024"

[dependencies]
rmcp = { version = "1.2", features = ["server", "transport-io"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "process", "net", "sync", "time"] }
thiserror = "2"
serde = { version = "1", features = ["derive"] }
schemars = "1"
rosc = "0.10"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
glob = "0.3"
regex = "1"

[lints.clippy]
all = "warn"
pedantic = "warn"
nursery = "warn"
```

- [ ] **Step 3: Create flake.nix**

Create `flake.nix`:

```nix
{
  description = "MCP server for TidalCycles live coding";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    crane.url = "github:ipetkov/crane";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    fenix,
    crane,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      fenixPkgs = fenix.packages.${system};
      toolchain = fenixPkgs.stable.toolchain;
      craneLib = (crane.mkLib pkgs).overrideToolchain toolchain;

      src = craneLib.cleanCargoSource ./.;

      commonArgs = {
        inherit src;
        strictDeps = true;
      };

      cargoArtifacts = craneLib.buildDepsOnly commonArgs;

      mcp-server-tidal-cycles = craneLib.buildPackage (commonArgs
        // {
          inherit cargoArtifacts;
        });
    in {
      packages.default = mcp-server-tidal-cycles;

      devShells.default = craneLib.devShell {
        packages = [
          pkgs.cargo-nextest
        ];
      };
    });
}
```

- [ ] **Step 4: Create src/errors.rs**

Create `src/errors.rs`:

```rust
use rmcp::ErrorData as McpError;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("tidal error: {0}")]
    Tidal(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("osc error: {0}")]
    Osc(String),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("timeout: {0}")]
    Timeout(String),
}

impl From<Error> for McpError {
    fn from(err: Error) -> Self {
        tracing::error!("{err}");
        Self::internal_error(err.to_string(), None)
    }
}
```

- [ ] **Step 5: Create minimal src/main.rs**

Create `src/main.rs`:

```rust
mod errors;

fn main() {
    println!("mcp-server-tidal-cycles");
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cargo build`
Expected: successful compilation

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml Cargo.lock flake.nix flake.lock src/main.rs src/errors.rs .gitignore
git commit -m "scaffold rust project with error types"
```

---

## Chunk 2: TidalProcess — GHCi Subprocess Management

### Task 2: Implement TidalProcess

**Files:**
- Create: `src/tidal.rs`
- Modify: `src/main.rs` (add mod declaration)

- [ ] **Step 1: Create src/tidal.rs with types and BootTidal discovery**

Create `src/tidal.rs`:

```rust
use std::path::PathBuf;
use std::sync::Arc;

use regex::Regex;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout, Duration};

use crate::errors::Error;

type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum TidalResponse {
    Success { output: Option<String> },
    Error { message: String },
}

pub struct TidalProcess {
    stdin: ChildStdin,
    stdout_buffer: Arc<Mutex<String>>,
    stderr_buffer: Arc<Mutex<String>>,
    child: Child,
}

fn find_boot_tidal() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let patterns = [
        format!(
            "{}/.cabal/share/tidal-*/BootTidal.hs",
            home.display()
        ),
        "/usr/share/tidal/BootTidal.hs".to_string(),
        "/usr/local/share/tidal/BootTidal.hs".to_string(),
        format!("{}/.local/share/tidal/BootTidal.hs", home.display()),
    ];

    for pattern in &patterns {
        if let Ok(paths) = glob::glob(pattern) {
            for entry in paths.flatten() {
                if entry.exists() {
                    return Some(entry);
                }
            }
        }
    }
    None
}

impl TidalProcess {
    pub async fn start() -> Result<Self> {
        let boot_path = find_boot_tidal();

        let mut args = vec!["--interactive".to_string()];
        if let Some(ref path) = boot_path {
            args.push("-ghci-script".to_string());
            args.push(path.to_string_lossy().to_string());
        }

        let mut child = tokio::process::Command::new("ghci")
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| Error::Tidal(format!("failed to start ghci: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::Tidal("failed to open ghci stdin".to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::Tidal("failed to open ghci stdout".to_string()))?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| Error::Tidal("failed to open ghci stderr".to_string()))?;

        let stdout_buffer = Arc::new(Mutex::new(String::new()));
        let stderr_buffer = Arc::new(Mutex::new(String::new()));

        // Drain stdout
        let stdout_buf = Arc::clone(&stdout_buffer);
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut reader = stdout;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]);
                        stdout_buf.lock().await.push_str(&text);
                    }
                }
            }
        });

        // Drain stderr
        let stderr_buf = Arc::clone(&stderr_buffer);
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut reader = stderr;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]);
                        stderr_buf.lock().await.push_str(&text);
                    }
                }
            }
        });

        // Wait for ready prompt
        let ready_buf = Arc::clone(&stdout_buffer);
        timeout(Duration::from_secs(30), async {
            loop {
                {
                    let buf = ready_buf.lock().await;
                    if buf.contains("tidal>") || buf.contains("Prelude>") {
                        return;
                    }
                }
                sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .map_err(|_| {
            Error::Timeout(
                "tidal startup timeout. Make sure GHCi and Tidal are installed.".to_string(),
            )
        })?;

        tracing::info!("tidal process started");

        Ok(Self {
            stdin,
            stdout_buffer,
            stderr_buffer,
            child,
        })
    }

    pub async fn send(&mut self, code: &str) -> Result<TidalResponse> {
        // Auto-restart if process died
        if !self.is_running() {
            tracing::warn!("ghci process died, restarting");
            let new = Self::start().await?;
            *self = new;
        }

        // Clear buffers
        self.stdout_buffer.lock().await.clear();
        self.stderr_buffer.lock().await.clear();

        // Write code
        self.stdin
            .write_all(format!("{code}\n").as_bytes())
            .await
            .map_err(|e| Error::Tidal(format!("failed to write to ghci: {e}")))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| Error::Tidal(format!("failed to flush ghci stdin: {e}")))?;

        // Wait for execution
        sleep(Duration::from_millis(200)).await;

        // Check for errors
        let stderr = self.stderr_buffer.lock().await.clone();
        if let Some(error) = parse_error(&stderr) {
            return Ok(TidalResponse::Error { message: error });
        }

        let output = self.stdout_buffer.lock().await.clone();
        let trimmed = output.trim().to_string();
        Ok(TidalResponse::Success {
            output: if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            },
        })
    }

    pub async fn stop(&mut self) {
        let _ = self.stdin.write_all(b":quit\n").await;
        let _ = self.child.kill().await;
    }

    pub fn is_running(&mut self) -> bool {
        self.child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
    }
}

fn parse_error(stderr: &str) -> Option<String> {
    let patterns = [
        r"(?si)error:.*?(?:\n\n|\n[^\s]|$)",
        r"(?si)parse error.*?(?:\n\n|\n[^\s]|$)",
        r"(?si)not in scope.*?(?:\n\n|\n[^\s]|$)",
        r"(?si)couldn't match.*?(?:\n\n|\n[^\s]|$)",
    ];

    for pattern in &patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(m) = re.find(stderr) {
                return Some(m.as_str().trim().to_string());
            }
        }
    }

    // Fallback generic check
    if stderr.contains("error")
        || stderr.contains("Error")
        || stderr.contains("exception")
    {
        return Some(stderr.trim().to_string());
    }

    None
}
```

Note: Add `dirs = "6"` to Cargo.toml dependencies for home directory discovery.

- [ ] **Step 2: Add mod declaration to main.rs**

Update `src/main.rs`:

```rust
mod errors;
mod tidal;

fn main() {
    println!("mcp-server-tidal-cycles");
}
```

- [ ] **Step 3: Add dirs dependency to Cargo.toml**

Add under `[dependencies]`:

```toml
dirs = "6"
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo build`
Expected: successful compilation

- [ ] **Step 5: Commit**

```bash
git add src/tidal.rs src/main.rs Cargo.toml Cargo.lock
git commit -m "add TidalProcess ghci subprocess management"
```

---

## Chunk 3: AudioAnalyzer — OSC Communication

### Task 3: Implement AudioAnalyzer

**Files:**
- Create: `src/analyzer.rs`
- Modify: `src/main.rs` (add mod declaration)

- [ ] **Step 1: Create src/analyzer.rs**

Create `src/analyzer.rs`:

```rust
use std::net::SocketAddr;

use rosc::{OscMessage, OscPacket, OscType};
use tokio::net::UdpSocket;
use tokio::time::{timeout, Duration};

use crate::errors::Error;

type Result<T> = std::result::Result<T, Error>;

const LOCAL_PORT: u16 = 57130;
const SC_PORT: u16 = 57120;

pub struct AnalysisResult {
    pub amplitude: Vec<f32>,
    pub rms: Vec<f32>,
    pub centroid: Vec<f32>,
    pub flatness: Vec<f32>,
    pub onsets: u32,
}

impl AnalysisResult {
    pub fn summary(&self, duration: u32) -> String {
        let avg_amp = avg(&self.amplitude);
        let max_amp = max(&self.amplitude);
        let avg_rms = avg(&self.rms);
        let avg_centroid = avg(&self.centroid);
        let avg_flatness = avg(&self.flatness);

        let brightness = if avg_centroid < 1000.0 {
            "dark/bassy"
        } else if avg_centroid < 3000.0 {
            "balanced"
        } else if avg_centroid < 6000.0 {
            "bright"
        } else {
            "very bright/harsh"
        };

        let noisiness = if avg_flatness < 0.2 {
            "tonal/melodic"
        } else if avg_flatness < 0.5 {
            "mixed"
        } else {
            "noisy/percussive"
        };

        format!(
            "Audio Analysis ({duration}s):\n\
             - Amplitude: avg {avg_amp:.3}, peak {max_amp:.3}\n\
             - RMS Level: {avg_rms:.3}\n\
             - Spectral Centroid: {avg_centroid:.0} Hz ({brightness})\n\
             - Spectral Flatness: {avg_flatness:.3} ({noisiness})\n\
             - Onsets Detected: {}\n\
             - Samples Collected: {}",
            self.onsets,
            self.amplitude.len()
        )
    }
}

fn avg(arr: &[f32]) -> f32 {
    if arr.is_empty() {
        return 0.0;
    }
    arr.iter().sum::<f32>() / arr.len() as f32
}

fn max(arr: &[f32]) -> f32 {
    arr.iter().copied().fold(0.0_f32, f32::max)
}

pub async fn analyze(duration_secs: u32) -> Result<AnalysisResult> {
    let local_addr: SocketAddr = ([127, 0, 0, 1], LOCAL_PORT).into();
    let sc_addr: SocketAddr = ([127, 0, 0, 1], SC_PORT).into();

    let socket = UdpSocket::bind(local_addr)
        .await
        .map_err(|e| Error::Osc(format!("failed to bind UDP socket on {local_addr}: {e}")))?;

    // Send start analysis command
    let msg = OscMessage {
        addr: "/tidal/startAnalysis".to_string(),
        args: vec![OscType::Int(i32::try_from(duration_secs).unwrap_or(5))],
    };
    let packet = OscPacket::Message(msg);
    let encoded =
        rosc::encoder::encode(&packet).map_err(|e| Error::Osc(format!("osc encode: {e}")))?;
    socket
        .send_to(&encoded, sc_addr)
        .await
        .map_err(|e| Error::Osc(format!("failed to send to SuperCollider: {e}")))?;

    let mut result = AnalysisResult {
        amplitude: Vec::new(),
        rms: Vec::new(),
        centroid: Vec::new(),
        flatness: Vec::new(),
        onsets: 0,
    };

    let duration_timeout = Duration::from_secs(u64::from(duration_secs) + 1);
    let mut buf = [0u8; 4096];

    timeout(duration_timeout, async {
        loop {
            let (size, _) = match socket.recv_from(&mut buf).await {
                Ok(v) => v,
                Err(_) => continue,
            };

            let packet = match rosc::decoder::decode_udp(&buf[..size]) {
                Ok((_, packet)) => packet,
                Err(_) => continue,
            };

            if let OscPacket::Message(msg) = packet {
                match msg.addr.as_str() {
                    "/analysis/result" => {
                        if msg.args.len() >= 5 {
                            let amp = extract_f32(&msg.args[0]);
                            let rms_val = extract_f32(&msg.args[1]);
                            let centroid = extract_f32(&msg.args[2]);
                            let flatness = extract_f32(&msg.args[3]);
                            let onset = extract_f32(&msg.args[4]);

                            result.amplitude.push(amp);
                            result.rms.push(rms_val);
                            result.centroid.push(centroid);
                            result.flatness.push(flatness);
                            if onset > 0.5 {
                                result.onsets += 1;
                            }
                        }
                    }
                    "/analysis/done" => break,
                    _ => {}
                }
            }
        }
    })
    .await
    .ok(); // Timeout is acceptable — we still return collected data

    Ok(result)
}

fn extract_f32(arg: &OscType) -> f32 {
    match arg {
        OscType::Float(f) => *f,
        OscType::Double(d) => *d as f32,
        OscType::Int(i) => *i as f32,
        _ => 0.0,
    }
}
```

- [ ] **Step 2: Add mod declaration to main.rs**

Update `src/main.rs`:

```rust
mod analyzer;
mod errors;
mod tidal;

fn main() {
    println!("mcp-server-tidal-cycles");
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo build`
Expected: successful compilation

- [ ] **Step 4: Commit**

```bash
git add src/analyzer.rs src/main.rs
git commit -m "add audio analyzer with OSC communication"
```

---

## Chunk 4: Tools — Shared Types, Patterns, Control, Analysis

### Task 4: Implement tool modules

**Files:**
- Create: `src/tools.rs`
- Create: `src/tools/patterns.rs`
- Create: `src/tools/control.rs`
- Create: `src/tools/analysis.rs`
- Modify: `src/main.rs` (add mod declaration)

- [ ] **Step 1: Create src/tools.rs with shared types**

Create `src/tools.rs`:

```rust
pub mod analysis;
pub mod control;
pub mod patterns;

use schemars::JsonSchema;
use serde::Deserialize;

use crate::errors::Error;

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TransitionType {
    Xfade,
    Clutch,
    Anticipate,
    Jump,
    JumpIn,
    JumpMod,
}

pub fn validate_channel(channel: u8) -> Result<u8, Error> {
    if (1..=16).contains(&channel) {
        Ok(channel)
    } else {
        Err(Error::Validation(
            "channel must be between 1 and 16".to_string(),
        ))
    }
}
```

- [ ] **Step 2: Create src/tools/patterns.rs**

Create `src/tools/patterns.rs`:

```rust
use crate::errors::Error;
use crate::tidal::{TidalProcess, TidalResponse};
use crate::tools::{validate_channel, TransitionType};

pub async fn send_pattern(
    tidal: &mut TidalProcess,
    channel: u8,
    pattern: &str,
) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    if pattern.is_empty() {
        return Err(Error::Validation("pattern is required".to_string()));
    }
    let result = tidal.send(&format!("d{ch} $ {pattern}")).await?;
    match result {
        TidalResponse::Success { .. } => Ok(format!("Playing on d{ch}: {pattern}")),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

pub async fn silence(
    tidal: &mut TidalProcess,
    channel: Option<u8>,
) -> Result<String, Error> {
    match channel {
        Some(ch) => {
            let ch = validate_channel(ch)?;
            let result = tidal.send(&format!("d{ch} silence")).await?;
            match result {
                TidalResponse::Success { .. } => Ok(format!("Silenced channel d{ch}")),
                TidalResponse::Error { message } => Err(Error::Tidal(message)),
            }
        }
        None => {
            let result = tidal.send("hush").await?;
            match result {
                TidalResponse::Success { .. } => Ok("Silenced all channels".to_string()),
                TidalResponse::Error { message } => Err(Error::Tidal(message)),
            }
        }
    }
}

pub async fn transition(
    tidal: &mut TidalProcess,
    channel: u8,
    pattern: &str,
    transition_type: &TransitionType,
    cycles: Option<f64>,
) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    if pattern.is_empty() {
        return Err(Error::Validation("pattern is required".to_string()));
    }

    let code = match transition_type {
        TransitionType::Xfade => match cycles {
            Some(c) => format!("xfadeIn {ch} {c} $ {pattern}"),
            None => format!("xfade {ch} $ {pattern}"),
        },
        TransitionType::Clutch => match cycles {
            Some(c) => format!("clutchIn {ch} {c} $ {pattern}"),
            None => format!("clutch {ch} $ {pattern}"),
        },
        TransitionType::Anticipate => format!("anticipate {ch} $ {pattern}"),
        TransitionType::Jump => format!("jump {ch} $ {pattern}"),
        TransitionType::JumpIn => {
            let c = cycles.unwrap_or(1.0);
            format!("jumpIn {ch} {c} $ {pattern}")
        }
        TransitionType::JumpMod => {
            let c = cycles.unwrap_or(4.0);
            format!("jumpMod {ch} {c} $ {pattern}")
        }
    };

    let result = tidal.send(&code).await?;
    let type_name = match transition_type {
        TransitionType::Xfade => "xfade",
        TransitionType::Clutch => "clutch",
        TransitionType::Anticipate => "anticipate",
        TransitionType::Jump => "jump",
        TransitionType::JumpIn => "jumpIn",
        TransitionType::JumpMod => "jumpMod",
    };
    let cycle_info = cycles
        .map(|c| format!(" over {c} cycles"))
        .unwrap_or_default();

    match result {
        TidalResponse::Success { .. } => {
            Ok(format!("Transitioning d{ch} with {type_name}{cycle_info}: {pattern}"))
        }
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

pub async fn once(tidal: &mut TidalProcess, pattern: &str) -> Result<String, Error> {
    if pattern.is_empty() {
        return Err(Error::Validation("pattern is required".to_string()));
    }
    let result = tidal.send(&format!("once $ {pattern}")).await?;
    match result {
        TidalResponse::Success { .. } => Ok(format!("Playing once: {pattern}")),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}
```

- [ ] **Step 3: Create src/tools/control.rs**

Create `src/tools/control.rs`:

```rust
use crate::errors::Error;
use crate::tidal::{TidalProcess, TidalResponse};
use crate::tools::validate_channel;

pub async fn set_tempo(tidal: &mut TidalProcess, cps: f64) -> Result<String, Error> {
    if cps <= 0.0 {
        return Err(Error::Validation(
            "CPS must be a positive number".to_string(),
        ));
    }
    let result = tidal.send(&format!("setcps {cps}")).await?;
    let bpm = (cps * 60.0 * 4.0).round() as u32;
    match result {
        TidalResponse::Success { .. } => Ok(format!("Tempo set to {cps} cps (~{bpm} BPM)")),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

pub async fn solo(
    tidal: &mut TidalProcess,
    channel: u8,
    enable: bool,
) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    let cmd = if enable { "solo" } else { "unsolo" };
    let result = tidal.send(&format!("{cmd} {ch}")).await?;
    let action = if enable { "Soloed" } else { "Unsoloed" };
    match result {
        TidalResponse::Success { .. } => Ok(format!("{action} channel d{ch}")),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

pub async fn mute(
    tidal: &mut TidalProcess,
    channel: u8,
    enable: bool,
) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    let cmd = if enable { "mute" } else { "unmute" };
    let result = tidal.send(&format!("{cmd} {ch}")).await?;
    let action = if enable { "Muted" } else { "Unmuted" };
    match result {
        TidalResponse::Success { .. } => Ok(format!("{action} channel d{ch}")),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

pub async fn panic(tidal: &mut TidalProcess) -> Result<String, Error> {
    let result = tidal.send("panic").await?;
    match result {
        TidalResponse::Success { .. } => Ok("MIDI panic sent - all notes off".to_string()),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

pub async fn reset_cycles(tidal: &mut TidalProcess) -> Result<String, Error> {
    let result = tidal.send("resetCycles").await?;
    match result {
        TidalResponse::Success { .. } => Ok("Cycle count reset to 0".to_string()),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

pub async fn tidal_code(
    tidal: &mut TidalProcess,
    code: &str,
) -> Result<String, Error> {
    if code.is_empty() {
        return Err(Error::Validation("code is required".to_string()));
    }
    let result = tidal.send(code).await?;
    match result {
        TidalResponse::Success { output } => match output {
            Some(out) => Ok(format!("Output: {out}")),
            None => Ok("Code executed successfully".to_string()),
        },
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}
```

- [ ] **Step 4: Create src/tools/analysis.rs**

Create `src/tools/analysis.rs`:

```rust
use crate::analyzer;
use crate::errors::Error;

pub async fn analyze(duration: Option<u32>) -> Result<String, Error> {
    let dur = duration.unwrap_or(5);
    if dur < 1 || dur > 30 {
        return Err(Error::Validation(
            "duration must be between 1 and 30 seconds".to_string(),
        ));
    }
    let result = analyzer::analyze(dur).await?;
    Ok(result.summary(dur))
}
```

- [ ] **Step 5: Add mod declaration to main.rs**

Update `src/main.rs`:

```rust
mod analyzer;
mod errors;
mod tidal;
mod tools;

fn main() {
    println!("mcp-server-tidal-cycles");
}
```

- [ ] **Step 6: Create tools directory**

```bash
mkdir -p src/tools
```

- [ ] **Step 7: Verify it compiles**

Run: `cargo build`
Expected: successful compilation

- [ ] **Step 8: Commit**

```bash
git add src/tools.rs src/tools/ src/main.rs
git commit -m "add tool implementations for patterns, control, and analysis"
```

---

## Chunk 5: Resources — Embedded Documentation

### Task 5: Extract resource markdown files and create resources module

**Files:**
- Create: `resources/mini-notation.md`
- Create: `resources/samples.md`
- Create: `resources/effects.md`
- Create: `resources/examples.md`
- Create: `resources/supercollider-analysis.md`
- Create: `src/resources.rs`
- Modify: `src/main.rs` (add mod declaration)

- [ ] **Step 1: Create resources/ directory and extract markdown files**

Create `resources/mini-notation.md`:

```markdown
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
```

Create `resources/samples.md`:

```markdown
# SuperDirt Default Samples

## Drums
- `bd` - bass drums (24 variations)
- `sd` - snare drums
- `hh` - hi-hats (closed)
- `oh` or `ho` - open hi-hats
- `cp` - claps
- `cr` - crash cymbals
- `rd` - ride cymbals
- `sn` - more snares
- `drum` - acoustic drum kit
- `drumtraks` - drum machine sounds
- `tabla`, `tabla2` - tabla drums

## Bass
- `bass`, `bass0`, `bass1`, `bass2`, `bass3`
- `db` - double bass
- `wobble` - wobble bass

## Synths/Keys
- `arpy` - arpeggio synth notes
- `superpiano` - piano (use with n for notes)
- `supersaw` - saw synth
- `supersquare` - square wave
- `superhammond` - organ
- `supervibe` - vibraphone

## Melodic
- `pluck` - plucked strings
- `gtr` - guitar
- `flick` - various
- `jvbass` - synth bass

## Percussion
- `can` - cans
- `metal` - metallic hits
- `bottle` - bottles
- `casio` - casio keyboard

## Electronic
- `glitch`, `glitch2` - glitchy sounds
- `noise`, `noise2` - noise
- `industrial` - industrial sounds
- `future` - futuristic sounds

## Access variations
Use :n to select variation: `bd:3`, `sd:1`, `arpy:4`
```

Create `resources/effects.md`:

```markdown
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
```

Create `resources/examples.md`:

```markdown
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
```

Create `resources/supercollider-analysis.md`:

```markdown
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
```

- [ ] **Step 2: Create src/resources.rs**

Create `src/resources.rs`:

```rust
pub const MINI_NOTATION: &str = include_str!("../resources/mini-notation.md");
pub const SAMPLES: &str = include_str!("../resources/samples.md");
pub const EFFECTS: &str = include_str!("../resources/effects.md");
pub const EXAMPLES: &str = include_str!("../resources/examples.md");
pub const SC_ANALYSIS: &str = include_str!("../resources/supercollider-analysis.md");

pub struct ResourceInfo {
    pub uri: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub content: &'static str,
}

pub const RESOURCES: &[ResourceInfo] = &[
    ResourceInfo {
        uri: "tidal://docs/mini-notation",
        name: "Mini-Notation Reference",
        description: "TidalCycles mini-notation syntax for writing patterns",
        content: MINI_NOTATION,
    },
    ResourceInfo {
        uri: "tidal://docs/samples",
        name: "Sample Library",
        description: "List of default SuperDirt samples and categories",
        content: SAMPLES,
    },
    ResourceInfo {
        uri: "tidal://docs/effects",
        name: "Effects Reference",
        description: "Available effects and controls (gain, lpf, delay, etc.)",
        content: EFFECTS,
    },
    ResourceInfo {
        uri: "tidal://docs/examples",
        name: "Pattern Examples",
        description: "Example patterns for beats, melodies, and effects",
        content: EXAMPLES,
    },
    ResourceInfo {
        uri: "tidal://docs/supercollider-analysis",
        name: "SuperCollider Analysis Setup",
        description: "Code to enable audio analysis in SuperCollider for the analyze tool",
        content: SC_ANALYSIS,
    },
];
```

- [ ] **Step 3: Add mod declaration to main.rs**

Update `src/main.rs`:

```rust
mod analyzer;
mod errors;
mod resources;
mod tidal;
mod tools;

fn main() {
    println!("mcp-server-tidal-cycles");
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo build`
Expected: successful compilation

- [ ] **Step 5: Commit**

```bash
git add resources/ src/resources.rs src/main.rs
git commit -m "add embedded resource documentation"
```

---

## Chunk 6: Server — MCP Wiring with Tools, Prompts, Resources

### Task 6: Implement MCP server with all handlers

**Files:**
- Create: `src/server.rs`
- Modify: `src/main.rs` (full entry point)

- [ ] **Step 1: Create src/server.rs**

Create `src/server.rs`. This is the largest file — it wires up all tools, prompts, and resources via rmcp macros and manual ServerHandler implementation.

```rust
use std::sync::Arc;

use rmcp::handler::server::prompt::PromptRouter;
use rmcp::handler::server::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, Content, GetPromptResult, Implementation, ListResourcesResult,
    Prompt, PromptMessage, ReadResourceResult, Resource, ResourceContents,
    Role, ServerCapabilities, ServerInfo,
};
use rmcp::{prompt, prompt_handler, prompt_router, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::resources::RESOURCES;
use crate::tidal::TidalProcess;
use crate::tools;

#[derive(Clone)]
pub struct TidalMcpServer {
    tidal: Arc<Mutex<Option<TidalProcess>>>,
    tool_router: ToolRouter<Self>,
    prompt_router: PromptRouter<Self>,
}

impl TidalMcpServer {
    async fn get_tidal(&self) -> Result<tokio::sync::MutexGuard<'_, Option<TidalProcess>>, rmcp::ErrorData> {
        let mut guard = self.tidal.lock().await;
        if guard.is_none() {
            let process = TidalProcess::start()
                .await
                .map_err(rmcp::ErrorData::from)?;
            *guard = Some(process);
        }
        Ok(guard)
    }
}

// -- Tool parameter structs --

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SendPatternParams {
    /// Channel number (1-16, corresponds to d1-d16)
    pub channel: u8,
    /// TidalCycles pattern expression
    pub pattern: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SilenceParams {
    /// Channel number to silence (1-16). If omitted, silences all channels (hush).
    pub channel: Option<u8>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetTempoParams {
    /// Cycles per second (e.g., 0.5 for 120 BPM, 1 for 240 BPM)
    pub cps: f64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SoloParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// True to solo, false to unsolo
    pub enable: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MuteParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// True to mute, false to unmute
    pub enable: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TransitionParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// TidalCycles pattern expression to transition to
    pub pattern: String,
    /// Transition type
    #[serde(rename = "type")]
    pub transition_type: tools::TransitionType,
    /// Number of cycles for the transition
    pub cycles: Option<f64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct OnceParams {
    /// TidalCycles pattern expression to play once
    pub pattern: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AnalyzeParams {
    /// Duration in seconds to analyze (default: 5)
    pub duration: Option<u32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TidalCodeParams {
    /// TidalCycles or Haskell code to execute
    pub code: String,
}

// -- Prompt parameter structs --

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateBeatParams {
    /// Style of beat (e.g., 'techno', 'hip-hop', 'ambient')
    pub style: Option<String>,
    /// Desired tempo in BPM
    pub tempo: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateAmbientParams {
    /// Mood (e.g., 'dark', 'peaceful', 'spacey')
    pub mood: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ExplainPatternParams {
    /// The pattern code to explain
    pub pattern: String,
}

// -- Tool routing --

#[tool_router]
impl TidalMcpServer {
    pub fn new() -> Self {
        Self {
            tidal: Arc::new(Mutex::new(None)),
            tool_router: Self::tool_router(),
            prompt_router: Self::prompt_router(),
        }
    }

    #[tool(description = "Send a TidalCycles pattern to a specific channel (d1-d16). The pattern will be evaluated by Tidal and played through SuperDirt.")]
    async fn send_pattern(
        &self,
        params: Parameters<SendPatternParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::patterns::send_pattern(tidal, params.0.channel, &params.0.pattern)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Silence one or all TidalCycles channels (hush)")]
    async fn silence(
        &self,
        params: Parameters<SilenceParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::patterns::silence(tidal, params.0.channel)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Set the tempo in cycles per second (cps). Default Tidal tempo is 0.5625 cps (135 BPM). Formula: cps = bpm / 60 / 4")]
    async fn set_tempo(
        &self,
        params: Parameters<SetTempoParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::control::set_tempo(tidal, params.0.cps)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Solo or unsolo a channel. When soloed, only that channel plays.")]
    async fn solo(
        &self,
        params: Parameters<SoloParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::control::solo(tidal, params.0.channel, params.0.enable)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Mute or unmute a channel")]
    async fn mute(
        &self,
        params: Parameters<MuteParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::control::mute(tidal, params.0.channel, params.0.enable)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Transition to a new pattern using various transition effects")]
    async fn transition(
        &self,
        params: Parameters<TransitionParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::patterns::transition(
            tidal,
            params.0.channel,
            &params.0.pattern,
            &params.0.transition_type,
            params.0.cycles,
        )
        .await
        .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Play a pattern exactly once (one-shot)")]
    async fn once(
        &self,
        params: Parameters<OnceParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::patterns::once(tidal, &params.0.pattern)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Send MIDI panic (all notes off) to stop stuck MIDI notes")]
    async fn panic(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::control::panic(tidal)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Reset the cycle count to zero")]
    async fn reset_cycles(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::control::reset_cycles(tidal)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Analyze audio output for N seconds. Returns amplitude, spectral centroid (brightness), flatness (noisiness), and onset count. Requires SuperCollider analysis setup (see tidal://docs/supercollider-analysis resource).")]
    async fn analyze(
        &self,
        params: Parameters<AnalyzeParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let msg = tools::analysis::analyze(params.0.duration)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }

    #[tool(description = "Execute arbitrary TidalCycles/Haskell code in the Tidal REPL. Use for advanced operations not covered by other tools.")]
    async fn tidal_code(
        &self,
        params: Parameters<TidalCodeParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let mut guard = self.get_tidal().await?;
        let tidal = guard.as_mut().unwrap();
        let msg = tools::control::tidal_code(tidal, &params.0.code)
            .await
            .map_err(rmcp::ErrorData::from)?;
        Ok(CallToolResult::success(vec![Content::text(msg)]))
    }
}

// -- Prompt routing --

#[prompt_router]
impl TidalMcpServer {
    #[prompt(description = "Help create a drum beat pattern")]
    async fn create_beat(
        &self,
        params: Parameters<CreateBeatParams>,
    ) -> Result<GetPromptResult, rmcp::ErrorData> {
        let style = params.0.style.as_deref().unwrap_or("electronic");
        let tempo = params.0.tempo.as_deref().unwrap_or("120");
        Ok(GetPromptResult {
            description: None,
            messages: vec![PromptMessage {
                role: Role::User,
                content: Content::text(format!(
                    "Create a {style} drum beat at {tempo} BPM using TidalCycles.\n\n\
                     Read the mini-notation reference (tidal://docs/mini-notation) and samples list (tidal://docs/samples) first.\n\n\
                     Use the send_pattern tool to play patterns. Use multiple channels (d1, d2, d3) for different drum elements.\n\n\
                     Start simple and layer up. Set the tempo first with set_tempo."
                )),
            }],
        })
    }

    #[prompt(description = "Create an ambient/drone soundscape")]
    async fn create_ambient(
        &self,
        params: Parameters<CreateAmbientParams>,
    ) -> Result<GetPromptResult, rmcp::ErrorData> {
        let mood = params.0.mood.as_deref().unwrap_or("spacey");
        Ok(GetPromptResult {
            description: None,
            messages: vec![PromptMessage {
                role: Role::User,
                content: Content::text(format!(
                    "Create a {mood} ambient soundscape using TidalCycles.\n\n\
                     Read the effects reference (tidal://docs/effects) for reverb, delay, and filter settings.\n\n\
                     Use slow-moving patterns, long samples (pad, ambient, space), heavy reverb (room, size), and subtle filter modulation.\n\n\
                     Use the send_pattern tool. Keep tempo slow (try 0.25 cps or lower)."
                )),
            }],
        })
    }

    #[prompt(description = "Start an interactive live coding session with guidance")]
    async fn live_session(&self) -> Result<GetPromptResult, rmcp::ErrorData> {
        Ok(GetPromptResult {
            description: None,
            messages: vec![PromptMessage {
                role: Role::User,
                content: Content::text(
                    "Let's have an interactive TidalCycles live coding session!\n\n\
                     First, read all the documentation resources to understand patterns, samples, and effects.\n\n\
                     Then start with a simple pattern on d1 and gradually build up. Ask me what style or mood I want, then create patterns accordingly.\n\n\
                     Be ready to:\n\
                     - Add/remove layers on different channels\n\
                     - Apply effects and transitions\n\
                     - Respond to my feedback to evolve the music\n\
                     - Use transitions (xfade, clutch) to smoothly change patterns\n\
                     - Use the analyze tool to check audio characteristics and adjust accordingly\n\n\
                     Start by asking what kind of music I'd like to create."
                ),
            }],
        })
    }

    #[prompt(description = "Explain what a TidalCycles pattern does")]
    async fn explain_pattern(
        &self,
        params: Parameters<ExplainPatternParams>,
    ) -> Result<GetPromptResult, rmcp::ErrorData> {
        let pattern = &params.0.pattern;
        Ok(GetPromptResult {
            description: None,
            messages: vec![PromptMessage {
                role: Role::User,
                content: Content::text(format!(
                    "Explain what this TidalCycles pattern does:\n\n\
                     ```haskell\n\
                     {pattern}\n\
                     ```\n\n\
                     Break down:\n\
                     1. The sound/sample being used\n\
                     2. The rhythm structure (mini-notation)\n\
                     3. Any effects applied\n\
                     4. What it will sound like\n\n\
                     Reference the mini-notation docs (tidal://docs/mini-notation) if needed."
                )),
            }],
        })
    }
}

// -- ServerHandler with resource support --

#[tool_handler]
#[prompt_handler]
impl rmcp::handler::server::ServerHandler for TidalMcpServer {
    fn get_info(&self) -> ServerInfo {
        let mut capabilities = ServerCapabilities::default();
        capabilities.resources = Some(Default::default());
        ServerInfo::new(capabilities).with_server_info(Implementation::new(
            "mcp-server-tidal-cycles",
            env!("CARGO_PKG_VERSION"),
        ))
    }

    async fn list_resources(
        &self,
        _request: rmcp::model::PaginatedRequest,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ListResourcesResult, rmcp::ErrorData> {
        let resources = RESOURCES
            .iter()
            .map(|r| Resource {
                uri: r.uri.to_string(),
                name: Some(r.name.to_string()),
                description: Some(r.description.to_string()),
                mime_type: Some("text/markdown".to_string()),
                ..Default::default()
            })
            .collect();
        Ok(ListResourcesResult {
            resources,
            next_cursor: None,
        })
    }

    async fn read_resource(
        &self,
        request: rmcp::model::ReadResourceRequest,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<ReadResourceResult, rmcp::ErrorData> {
        let uri = &request.uri;
        let resource = RESOURCES
            .iter()
            .find(|r| r.uri == uri.as_str())
            .ok_or_else(|| rmcp::ErrorData::resource_not_found(format!("unknown resource: {uri}"), None))?;

        Ok(ReadResourceResult {
            contents: vec![ResourceContents::text(resource.content, &uri)],
        })
    }
}

impl TidalMcpServer {
    pub async fn shutdown(&self) {
        let mut guard = self.tidal.lock().await;
        if let Some(ref mut tidal) = *guard {
            tidal.stop().await;
        }
    }
}
```

- [ ] **Step 2: Update src/main.rs with full entry point**

Update `src/main.rs`:

```rust
mod analyzer;
mod errors;
mod resources;
mod server;
mod tidal;
mod tools;

use rmcp::ServiceExt;
use server::TidalMcpServer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let server = TidalMcpServer::new();
    let server_for_shutdown = server.clone();

    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        tracing::info!("shutting down");
        server_for_shutdown.shutdown().await;
        std::process::exit(0);
    });

    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo build`
Expected: successful compilation. There may be type issues with rmcp API — fix as needed (the exact types for `ListResourcesResult`, `ReadResourceResult`, `PaginatedRequest`, `ReadResourceRequest`, `ResourceContents`, `Resource`, `GetPromptResult`, `PromptMessage`, `Role`, `Content` may have slightly different paths in rmcp 1.2). Use `cargo doc --open` on rmcp or check `../wezterm-mcp` patterns to resolve.

- [ ] **Step 4: Fix any compilation errors**

Iterate on type imports and API usage until `cargo build` succeeds. The rmcp API surface may require adjustments — consult the rmcp docs or the wezterm-mcp reference.

- [ ] **Step 5: Run clippy**

Run: `cargo clippy -- -D warnings`
Expected: no warnings (fix any that appear)

- [ ] **Step 6: Commit**

```bash
git add src/server.rs src/main.rs
git commit -m "add MCP server with tools, prompts, and resources"
```

---

## Chunk 7: Update Project Config & Cleanup

### Task 7: Update project configuration files

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.gitignore`

- [ ] **Step 1: Update .gitignore for Rust**

Update `.gitignore` to include Rust targets:

```
/target
```

Remove any Node.js-specific entries (node_modules, build/, etc.) if they exist.

- [ ] **Step 2: Update CLAUDE.md**

Update `CLAUDE.md` to reflect the new Rust project. Replace the Commands section:

```markdown
## Commands

```bash
cargo build            # Build
cargo build --release  # Release build
cargo clippy           # Lint
cargo fmt              # Format
```
```

Update Architecture section to describe Rust modules. Update Prerequisites to remove Bun dependency. Update Configuration to point to the Rust binary.

- [ ] **Step 3: Verify full build**

Run: `cargo build`
Expected: successful compilation

- [ ] **Step 4: Run the binary to verify it starts**

Run: `cargo run 2>&1 | head -1`
Expected: the server starts (it will hang waiting for MCP client input via stdin, which is expected)

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .gitignore
git commit -m "update project config for rust rewrite"
```

### Task 8: Final verification

- [ ] **Step 1: Clean build**

Run: `cargo build --release`
Expected: successful compilation

- [ ] **Step 2: Check binary size**

Run: `ls -lh target/release/mcp-server-tidal-cycles`
Expected: reasonable binary size

- [ ] **Step 3: Run clippy pedantic**

Run: `cargo clippy -- -D warnings`
Expected: no warnings

- [ ] **Step 4: Run cargo fmt check**

Run: `cargo fmt -- --check`
Expected: no formatting issues

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "final cleanup for rust rewrite"
```
