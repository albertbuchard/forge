use utoipa::OpenApi;

use crate::api::routes::{ContextEnvelope, HealthEnvelope};

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::api::routes::health,
        crate::api::routes::context
    ),
    components(
        schemas(HealthEnvelope, ContextEnvelope)
    ),
    info(
        title = "Forge Local API",
        version = "0.1.0",
        description = "Canonical Rust/Axum local REST API for Forge."
    )
)]
pub struct ApiDoc;
