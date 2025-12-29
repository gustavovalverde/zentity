//! Health and build-info endpoints.

use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    status: String,
    service: String,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "fhe-service".to_string(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfoResponse {
    service: String,
    version: String,
    git_sha: String,
    build_time: String,
}

/// Build info endpoint for deployment verification.
/// Values are embedded at compile time via build.rs.
pub async fn build_info() -> Json<BuildInfoResponse> {
    Json(BuildInfoResponse {
        service: "fhe-service".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_sha: env!("GIT_SHA").to_string(),
        build_time: env!("BUILD_TIME").to_string(),
    })
}
