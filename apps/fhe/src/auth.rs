//! Internal authentication middleware shared by production and tests.

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use constant_time_eq::constant_time_eq;
use serde_json::json;

pub async fn internal_auth(
    State(token): State<Option<String>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    if let Some(expected) = token.as_ref().filter(|value| !value.is_empty()) {
        let provided = req
            .headers()
            .get("x-zentity-internal-token")
            .map(|value| value.as_bytes());
        if !provided.is_some_and(|provided| constant_time_eq(provided, expected.as_bytes())) {
            tracing::warn!("Unauthorized request to {}", req.uri().path());
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Unauthorized" })),
            )
                .into_response();
        }
    }

    next.run(req).await
}
