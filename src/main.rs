//! Unified Hi-Fi Control - Rust Implementation
//!
//! A source-agnostic hi-fi control bridge for hardware surfaces and Home Assistant.
//! This is a proof-of-concept spike exploring Rust as a replacement for the Node.js implementation.

mod adapters;
mod api;
mod config;

use anyhow::Result;
use axum::{routing::get, Router};
use std::net::SocketAddr;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            "unified_hifi_control=debug,tower_http=debug,axum::rejection=trace".into()
        }))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Unified Hi-Fi Control (Rust)");

    // Load configuration
    let config = config::load_config()?;
    tracing::info!(?config, "Configuration loaded");

    // Initialize adapters (Roon, HQPlayer, LMS)
    let roon = adapters::roon::RoonAdapter::new().await?;
    tracing::info!("Roon adapter initialized");

    // Build API routes
    let app = Router::new()
        .route("/status", get(api::status_handler))
        .route("/roon/zones", get(api::roon_zones_handler))
        .route("/roon/status", get(api::roon_status_handler))
        // Add more routes as we port them
        .layer(CorsLayer::permissive())
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(api::AppState::new(roon));

    // Start server
    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
