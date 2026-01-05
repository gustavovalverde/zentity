//! Router construction for the FHE HTTP API.

use axum::{
    error_handling::HandleErrorLayer,
    extract::DefaultBodyLimit,
    http::StatusCode,
    middleware,
    routing::{get, post},
    BoxError, Json, Router,
};
use serde::Serialize;
use tower::{limit::ConcurrencyLimitLayer, timeout::TimeoutLayer, ServiceBuilder};

use crate::{auth::internal_auth, routes, settings::Settings};

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

fn error_response(
    status: StatusCode,
    message: impl Into<String>,
) -> (StatusCode, Json<ErrorResponse>) {
    (
        status,
        Json(ErrorResponse {
            error: message.into(),
        }),
    )
}

pub fn build_router(settings: &Settings) -> Router {
    routes::init_cpu_limiter(settings.cpu_concurrency_limit());
    let middleware_stack = ServiceBuilder::new()
        .layer(HandleErrorLayer::new(|error: BoxError| async move {
            if error.is::<tower::timeout::error::Elapsed>() {
                error_response(StatusCode::REQUEST_TIMEOUT, "Request timed out")
            } else {
                error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Unhandled internal error: {error}"),
                )
            }
        }))
        .layer(TimeoutLayer::new(settings.request_timeout()))
        .layer(ConcurrencyLimitLayer::new(settings.concurrency_limit()))
        .layer(middleware::from_fn_with_state(
            settings.internal_token(),
            internal_auth,
        ))
        .layer(DefaultBodyLimit::max(settings.body_limit_bytes()));

    Router::new()
        .route("/health", get(routes::health))
        .route("/build-info", get(routes::build_info))
        .route("/keys/register", post(routes::register_key))
        .route("/keys/debug", get(routes::debug_keys))
        .route(
            "/encrypt-birth-year-offset",
            post(routes::encrypt_birth_year_offset),
        )
        .route("/encrypt-batch", post(routes::encrypt_batch))
        .route("/verify-age-offset", post(routes::verify_age_offset))
        .route("/encrypt-country-code", post(routes::encrypt_country_code))
        .route(
            "/encrypt-compliance-level",
            post(routes::encrypt_compliance_level),
        )
        .route("/encrypt-liveness", post(routes::encrypt_liveness))
        .route(
            "/verify-liveness-threshold",
            post(routes::verify_liveness_threshold),
        )
        .layer(middleware_stack)
}
