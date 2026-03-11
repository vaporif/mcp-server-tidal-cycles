use crate::errors::Error;
use crate::tidal::{TidalProcess, TidalResponse};
use crate::tools::{TransitionType, validate_channel};

fn handle_response(response: TidalResponse, success_msg: String) -> Result<String, Error> {
    match response {
        TidalResponse::Success { .. } => Ok(success_msg),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}

/// Send a pattern to a specific channel (d1-d16).
///
/// # Errors
///
/// Returns an error if the channel is invalid, the pattern is empty,
/// or the Tidal process rejects the code.
pub async fn send_pattern(
    tidal: &mut TidalProcess,
    channel: u8,
    pattern: &str,
) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    if pattern.trim().is_empty() {
        return Err(Error::Validation("pattern must not be empty".to_string()));
    }
    let code = format!("d{ch} $ {pattern}");
    let response = tidal.send(&code).await?;
    handle_response(response, format!("Playing on d{ch}: {pattern}"))
}

/// Silence a specific channel or all channels (hush).
///
/// # Errors
///
/// Returns an error if the channel is invalid or the Tidal process rejects the code.
pub async fn silence(
    tidal: &mut TidalProcess,
    channel: Option<u8>,
) -> Result<String, Error> {
    if let Some(ch) = channel {
        let ch = validate_channel(ch)?;
        let code = format!("d{ch} silence");
        let response = tidal.send(&code).await?;
        handle_response(response, format!("Silenced channel d{ch}"))
    } else {
        let response = tidal.send("hush").await?;
        handle_response(response, "Silenced all channels".to_string())
    }
}

/// Transition to a new pattern using the specified transition type.
///
/// # Errors
///
/// Returns an error if the channel is invalid, the pattern is empty,
/// or the Tidal process rejects the code.
#[allow(clippy::cast_precision_loss)]
pub async fn transition(
    tidal: &mut TidalProcess,
    channel: u8,
    pattern: &str,
    transition_type: &TransitionType,
    cycles: Option<f64>,
) -> Result<String, Error> {
    let ch = validate_channel(channel)?;
    if pattern.trim().is_empty() {
        return Err(Error::Validation("pattern must not be empty".to_string()));
    }

    let (code, type_name, cycle_info) = match transition_type {
        TransitionType::Xfade => cycles.map_or_else(
            || (format!("xfade {ch} $ {pattern}"), "xfade", String::new()),
            |c| (
                format!("xfadeIn {ch} {c} $ {pattern}"),
                "xfade",
                format!(" over {c} cycles"),
            ),
        ),
        TransitionType::Clutch => cycles.map_or_else(
            || (format!("clutch {ch} $ {pattern}"), "clutch", String::new()),
            |c| (
                format!("clutchIn {ch} {c} $ {pattern}"),
                "clutch",
                format!(" over {c} cycles"),
            ),
        ),
        TransitionType::Anticipate => (
            format!("anticipate {ch} $ {pattern}"),
            "anticipate",
            String::new(),
        ),
        TransitionType::Jump => (
            format!("jump {ch} $ {pattern}"),
            "jump",
            String::new(),
        ),
        TransitionType::JumpIn => {
            let c = cycles.unwrap_or(1.0);
            (
                format!("jumpIn {ch} {c} $ {pattern}"),
                "jumpIn",
                format!(" over {c} cycles"),
            )
        }
        TransitionType::JumpMod => {
            let c = cycles.unwrap_or(4.0);
            (
                format!("jumpMod {ch} {c} $ {pattern}"),
                "jumpMod",
                format!(" over {c} cycles"),
            )
        }
    };

    let response = tidal.send(&code).await?;
    handle_response(
        response,
        format!("Transitioning d{ch} with {type_name}{cycle_info}: {pattern}"),
    )
}

/// Play a pattern once (one-shot).
///
/// # Errors
///
/// Returns an error if the pattern is empty or the Tidal process rejects the code.
pub async fn once(tidal: &mut TidalProcess, pattern: &str) -> Result<String, Error> {
    if pattern.trim().is_empty() {
        return Err(Error::Validation("pattern must not be empty".to_string()));
    }
    let code = format!("once $ {pattern}");
    let response = tidal.send(&code).await?;
    handle_response(response, format!("Playing once: {pattern}"))
}
