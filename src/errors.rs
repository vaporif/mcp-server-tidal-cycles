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
