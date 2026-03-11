use crate::errors::Error;
use crate::tidal::{TidalProcess, TidalResponse};
use crate::tools::validate_channel;

fn handle_response(response: TidalResponse, success_msg: String) -> Result<String, Error> {
    match response {
        TidalResponse::Success { output } => Ok(output.unwrap_or(success_msg)),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

/// Set the tempo in cycles per second.
///
/// # Errors
///
/// Returns an error if `cps` is not positive or the Tidal process rejects the code.
pub async fn set_tempo(tidal: &mut TidalProcess, cps: f64) -> Result<String, Error> {
    if cps <= 0.0 {
        return Err(Error::Validation(
            "cps must be greater than 0".to_string(),
        ));
    }
    let code = format!("setcps {cps}");
    let response = tidal.send(&code).await?;
    let bpm = (cps * 60.0 * 4.0).round();
    match response {
        TidalResponse::Success { .. } => Ok(format!("Tempo set to {cps} cps (~{bpm} BPM)")),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

/// Solo or unsolo a channel.
///
/// # Errors
///
/// Returns an error if the channel is invalid or the Tidal process rejects the code.
pub async fn solo(
    tidal: &mut TidalProcess,
    channel: u8,
    enable: bool,
) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    let (cmd, label) = if enable {
        ("solo", "Soloed")
    } else {
        ("unsolo", "Unsoloed")
    };
    let code = format!("{cmd} {ch}");
    let response = tidal.send(&code).await?;
    match response {
        TidalResponse::Success { .. } => Ok(format!("{label} channel d{ch}")),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

/// Mute or unmute a channel.
///
/// # Errors
///
/// Returns an error if the channel is invalid or the Tidal process rejects the code.
pub async fn mute(
    tidal: &mut TidalProcess,
    channel: u8,
    enable: bool,
) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    let (cmd, label) = if enable {
        ("mute", "Muted")
    } else {
        ("unmute", "Unmuted")
    };
    let code = format!("{cmd} {ch}");
    let response = tidal.send(&code).await?;
    match response {
        TidalResponse::Success { .. } => Ok(format!("{label} channel d{ch}")),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

/// Send MIDI panic (all notes off).
///
/// # Errors
///
/// Returns an error if the Tidal process rejects the code.
pub async fn panic(tidal: &mut TidalProcess) -> Result<String, Error> {
    let response = tidal.send("panic").await?;
    match response {
        TidalResponse::Success { .. } => Ok("MIDI panic sent - all notes off".to_string()),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

/// Reset the cycle count to 0.
///
/// # Errors
///
/// Returns an error if the Tidal process rejects the code.
pub async fn reset_cycles(tidal: &mut TidalProcess) -> Result<String, Error> {
    let response = tidal.send("resetCycles").await?;
    match response {
        TidalResponse::Success { .. } => Ok("Cycle count reset to 0".to_string()),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
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
