//! Internal authentication middleware shared by production and tests.

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
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
            .and_then(|value| value.to_str().ok());
        if provided != Some(expected.as_str()) {
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
