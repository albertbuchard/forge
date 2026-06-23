mod api;
mod app_state;

use std::net::SocketAddr;

use api::openapi::ApiDoc;
use api::routes;
use app_state::AppState;
use axum::{routing::get, Router};
use tauri::Manager;
use utoipa::OpenApi;

async fn run_local_api() -> anyhow::Result<()> {
    let state = AppState::default();
    let app = Router::new()
        .merge(routes::router(state.clone()))
        .route("/api/v1/events/stream", get(api::sse::stream))
        .route(
            "/api/v1/openapi.json",
            get(|| async { axum::Json(ApiDoc::openapi()) }),
        );

    let addr = SocketAddr::from(([127, 0, 0, 1], 3817));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = run_local_api().await {
                    let _ = handle.emit("forge://backend-error", error.to_string());
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Forge Tauri application");
}
