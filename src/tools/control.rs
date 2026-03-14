use schemars::JsonSchema;
use serde::Deserialize;

use crate::errors::Error;
use crate::tidal::TidalProcess;
use crate::tools::{handle_response, validate_channel};

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetTempoParams {
    /// Tempo in cycles per second
    pub cps: f64,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SoloParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// true to solo, false to unsolo
    pub enable: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MuteParams {
    /// Channel number (1-16)
    pub channel: u8,
    /// true to mute, false to unmute
    pub enable: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TidalCodeParams {
    /// Arbitrary Tidal/Haskell code to execute
    pub code: String,
}

/// Set the tempo in cycles per second.
///
/// # Errors
///
/// Returns an error if `cps` is not positive or the Tidal process rejects the code.
pub async fn set_tempo(tidal: &mut TidalProcess, cps: f64) -> Result<String, Error> {
    if cps <= 0.0 {
        return Err(Error::Validation("cps must be greater than 0".to_string()));
    }
    let code = format!("setcps {cps}");
    let response = tidal.send(&code).await?;
    let bpm = (cps * 60.0 * 4.0).round();
    handle_response(response, format!("Tempo set to {cps} cps (~{bpm} BPM)"))
}

/// Solo or unsolo a channel.
///
/// # Errors
///
/// Returns an error if the channel is invalid or the Tidal process rejects the code.
pub async fn solo(tidal: &mut TidalProcess, channel: u8, enable: bool) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    let (cmd, label) = if enable {
        ("solo", "Soloed")
    } else {
        ("unsolo", "Unsoloed")
    };
    let code = format!("{cmd} {ch}");
    let response = tidal.send(&code).await?;
    handle_response(response, format!("{label} channel d{ch}"))
}

/// Mute or unmute a channel.
///
/// # Errors
///
/// Returns an error if the channel is invalid or the Tidal process rejects the code.
pub async fn mute(tidal: &mut TidalProcess, channel: u8, enable: bool) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    let (cmd, label) = if enable {
        ("mute", "Muted")
    } else {
        ("unmute", "Unmuted")
    };
    let code = format!("{cmd} {ch}");
    let response = tidal.send(&code).await?;
    handle_response(response, format!("{label} channel d{ch}"))
}

/// Send MIDI panic (all notes off).
///
/// # Errors
///
/// Returns an error if the Tidal process rejects the code.
pub async fn panic(tidal: &mut TidalProcess) -> Result<String, Error> {
    let response = tidal.send("panic").await?;
    handle_response(response, "MIDI panic sent - all notes off".to_string())
}

/// Reset the cycle count to 0.
///
/// # Errors
///
/// Returns an error if the Tidal process rejects the code.
pub async fn reset_cycles(tidal: &mut TidalProcess) -> Result<String, Error> {
    let response = tidal.send("resetCycles").await?;
    handle_response(response, "Cycle count reset to 0".to_string())
}

/// Execute arbitrary Tidal/Haskell code.
///
/// # Errors
///
/// Returns an error if the code is empty or the Tidal process rejects it.
pub async fn tidal_code(tidal: &mut TidalProcess, code: &str) -> Result<String, Error> {
    if code.trim().is_empty() {
        return Err(Error::Validation("code must not be empty".to_string()));
    }
    let response = tidal.send(code).await?;
    handle_response(response, "Code executed successfully".to_string())
}
