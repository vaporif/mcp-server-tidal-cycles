use schemars::JsonSchema;
use serde::Deserialize;

use crate::errors::Error;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct AnalyzeParams {
    /// Duration in seconds (1-30, default 5)
    pub duration: Option<u32>,
}

/// Analyze audio for a given duration (1-30 seconds).
///
/// # Errors
///
/// Returns an error if the duration is out of range or the analysis fails.
pub async fn analyze(duration: Option<u32>) -> Result<String, Error> {
    let dur = duration.unwrap_or(5);
    if !(1..=30).contains(&dur) {
        return Err(Error::Validation(
            "duration must be between 1 and 30 seconds".to_string(),
        ));
    }
    let result = crate::analyzer::analyze(dur).await?;
    Ok(result.summary(dur))
}
