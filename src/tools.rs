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
