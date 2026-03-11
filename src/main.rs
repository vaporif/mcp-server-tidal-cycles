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
