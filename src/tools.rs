pub mod analysis;
pub mod control;
pub mod patterns;

use schemars::JsonSchema;
use serde::Deserialize;

use crate::errors::Error;
use crate::tidal::TidalResponse;

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

pub fn handle_response(response: TidalResponse, success_msg: String) -> Result<String, Error> {
    match response {
        TidalResponse::Success { output } => Ok(output.unwrap_or(success_msg)),
        TidalResponse::Error { message } => Err(Error::Tidal(message)),
    }
}
