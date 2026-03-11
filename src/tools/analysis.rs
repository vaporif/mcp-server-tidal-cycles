use crate::errors::Error;

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
