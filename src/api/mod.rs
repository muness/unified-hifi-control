//! HTTP API handlers

use crate::adapters::roon::RoonAdapter;
use axum::{extract::State, Json};
use serde::Serialize;
use std::sync::Arc;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub roon: Arc<RoonAdapter>,
}

impl AppState {
    pub fn new(roon: RoonAdapter) -> Self {
        Self {
            roon: Arc::new(roon),
        }
    }
}

/// General status response
#[derive(Serialize)]
pub struct StatusResponse {
    pub service: &'static str,
    pub version: &'static str,
    pub uptime_secs: u64,
}

/// GET /status - Service health check
pub async fn status_handler() -> Json<StatusResponse> {
    Json(StatusResponse {
        service: "unified-hifi-control",
        version: env!("CARGO_PKG_VERSION"),
        uptime_secs: 0, // TODO: Track actual uptime
    })
}

/// GET /roon/status - Roon connection status
pub async fn roon_status_handler(State(state): State<AppState>) -> Json<crate::adapters::roon::RoonStatus> {
    Json(state.roon.get_status().await)
}

/// GET /roon/zones - List all Roon zones
pub async fn roon_zones_handler(State(state): State<AppState>) -> Json<Vec<crate::adapters::roon::Zone>> {
    Json(state.roon.get_zones().await)
}
