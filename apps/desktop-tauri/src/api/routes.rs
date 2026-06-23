use axum::{extract::State, response::Json, routing::get, Router};
use serde::Serialize;
use utoipa::ToSchema;

use crate::app_state::AppState;

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthEnvelope {
    pub ok: bool,
    pub api_version: &'static str,
    pub backend: &'static str,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ContextEnvelope {
    pub api_version: &'static str,
    pub backend_mode: &'static str,
    pub note: &'static str,
}

#[utoipa::path(
    get,
    path = "/api/v1/health",
    responses(
        (status = 200, description = "Health surface", body = HealthEnvelope)
    )
)]
pub async fn health(State(state): State<AppState>) -> Json<HealthEnvelope> {
    Json(HealthEnvelope {
        ok: true,
        api_version: state.api_version,
        backend: "forge-rust",
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/context",
    responses(
        (status = 200, description = "Command center context", body = ContextEnvelope)
    )
)]
pub async fn context(State(state): State<AppState>) -> Json<ContextEnvelope> {
    Json(ContextEnvelope {
        api_version: state.api_version,
        backend_mode: state.backend_mode,
        note: "Context aggregation, SQLite domain logic, and event-derived gamification belong here.",
    })
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/context", get(context))
        .with_state(state)
}
