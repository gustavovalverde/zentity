//! Router construction for the FHE HTTP API.

use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{get, post},
    Router,
};

use crate::{auth::internal_auth, routes, settings::Settings};

pub fn build_router(settings: &Settings) -> Router {
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
        .layer(middleware::from_fn_with_state(
            settings.internal_token(),
            internal_auth,
        ))
        .layer(DefaultBodyLimit::max(settings.body_limit_bytes()))
}
