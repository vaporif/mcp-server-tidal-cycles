use std::sync::Arc;

use regex::Regex;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin},
    sync::Mutex,
    time::{Duration, sleep, timeout},
};

use crate::errors::Error;

type Result<T> = std::result::Result<T, Error>;

const BOOT_TIMEOUT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const SEND_DELAY: Duration = Duration::from_millis(200);

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

impl TidalProcess {
    /// Start a new `GHCi` process with `TidalCycles` loaded.
    ///
    /// # Errors
    ///
    /// Returns an error if `BootTidal.hs` cannot be found, or if `GHCi` fails to
    /// start or does not produce a ready prompt within 30 seconds.
    pub async fn start() -> Result<Self> {
        let boot_path = find_boot_tidal()?;
        tracing::info!("using BootTidal.hs at {boot_path}");

        let mut child = tokio::process::Command::new("ghci")
            .args(["--interactive", "-ghci-script", &boot_path])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| Error::Tidal("failed to capture stdin".into()))?;

        let stdout_buffer = Arc::new(Mutex::new(String::new()));
        let stderr_buffer = Arc::new(Mutex::new(String::new()));

        // Drain stdout
        if let Some(mut stdout) = child.stdout.take() {
            let buf = Arc::clone(&stdout_buffer);
            tokio::spawn(async move {
                let mut tmp = [0u8; 1024];
                loop {
                    match stdout.read(&mut tmp).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&tmp[..n]);
                            buf.lock().await.push_str(&text);
                        }
                    }
                }
            });
        }

        // Drain stderr
        if let Some(mut stderr) = child.stderr.take() {
            let buf = Arc::clone(&stderr_buffer);
            tokio::spawn(async move {
                let mut tmp = [0u8; 1024];
                loop {
                    match stderr.read(&mut tmp).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&tmp[..n]);
                            buf.lock().await.push_str(&text);
                        }
                    }
                }
            });
        }

        // Wait for ready prompt
        let stdout_ref = Arc::clone(&stdout_buffer);
        timeout(BOOT_TIMEOUT, async {
            loop {
                {
                    let content = stdout_ref.lock().await;
                    if content.contains("tidal>") || content.contains("Prelude>") {
                        break;
                    }
                }
                sleep(POLL_INTERVAL).await;
            }
        })
        .await
        .map_err(|_| Error::Timeout("`GHCi` did not become ready within 30s".into()))?;

        tracing::info!("tidal process started");

        Ok(Self {
            stdin,
            stdout_buffer,
            stderr_buffer,
            child,
        })
    }

    /// Send a Tidal code expression to the running process.
    ///
    /// Auto-restarts the process if it has died.
    ///
    /// # Errors
    ///
    /// Returns an error if the process cannot be restarted or the write fails.
    pub async fn send(&mut self, code: &str) -> Result<TidalResponse> {
        if !self.is_running() {
            tracing::warn!("tidal process died, restarting");
            let new = Self::start().await?;
            *self = new;
        }

        // Clear buffers
        {
            self.stdout_buffer.lock().await.clear();
            self.stderr_buffer.lock().await.clear();
        }

        self.stdin
            .write_all(format!("{code}\n").as_bytes())
            .await?;
        self.stdin.flush().await?;

        sleep(SEND_DELAY).await;

        let stderr_content = self.stderr_buffer.lock().await.clone();

        if let Some(err_msg) = parse_error(&stderr_content) {
            return Ok(TidalResponse::Error { message: err_msg });
        }

        let stdout_content = self.stdout_buffer.lock().await.clone();
        let output = if stdout_content.trim().is_empty() {
            None
        } else {
            Some(stdout_content.trim().to_owned())
        };

        Ok(TidalResponse::Success { output })
    }

    /// Gracefully stop the `GHCi` process.
    pub async fn stop(&mut self) {
        let _ = self.stdin.write_all(b":quit\n").await;
        let _ = self.stdin.flush().await;
        let _ = self.child.kill().await;
    }

    /// Check whether the child process is still running.
    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

/// Locate `BootTidal.hs` by searching well-known paths.
fn find_boot_tidal() -> Result<String> {
    let home =
        dirs::home_dir().ok_or_else(|| Error::Tidal("cannot determine home directory".into()))?;

    let patterns = [
        format!("{}/.cabal/share/tidal-*/BootTidal.hs", home.display()),
        "/usr/share/tidal/BootTidal.hs".into(),
        "/usr/local/share/tidal/BootTidal.hs".into(),
        format!("{}/.local/share/tidal/BootTidal.hs", home.display()),
    ];

    for pattern in &patterns {
        if let Ok(mut paths) = glob::glob(pattern)
            && let Some(Ok(path)) = paths.next()
        {
            return Ok(path.display().to_string());
        }
    }

    Err(Error::Tidal(
        "BootTidal.hs not found — is tidal installed?".into(),
    ))
}

/// Parse `GHCi`/Tidal error messages from stderr output.
fn parse_error(stderr: &str) -> Option<String> {
    if stderr.trim().is_empty() {
        return None;
    }

    let patterns = [
        r"(?is)error:.*?(?:\n\n|\n[^\s]|$)",
        r"(?is)parse error.*?(?:\n\n|\n[^\s]|$)",
        r"(?is)not in scope.*?(?:\n\n|\n[^\s]|$)",
        r"(?is)couldn't match.*?(?:\n\n|\n[^\s]|$)",
    ];

    for pat in &patterns {
        if let Ok(re) = Regex::new(pat)
            && let Some(m) = re.find(stderr)
        {
            return Some(m.as_str().trim().to_owned());
        }
    }

    // Fallback: check for generic error keywords
    let lower = stderr.to_lowercase();
    if lower.contains("error") || lower.contains("exception") {
        return Some(stderr.trim().to_owned());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_error_returns_none_for_empty() {
        assert!(parse_error("").is_none());
        assert!(parse_error("   ").is_none());
    }

    #[test]
    fn parse_error_catches_error_keyword() {
        let stderr = "some Error occurred here";
        let result = parse_error(stderr);
        assert!(result.is_some());
    }

    #[test]
    fn parse_error_catches_not_in_scope() {
        let stderr = "Not in scope: 'foo'\n\nother stuff";
        let result = parse_error(stderr);
        assert!(result.is_some());
        assert!(result.unwrap().contains("Not in scope"));
    }

    #[test]
    fn parse_error_catches_parse_error() {
        let stderr = "parse error on input '+'";
        let result = parse_error(stderr);
        assert!(result.is_some());
    }
}
