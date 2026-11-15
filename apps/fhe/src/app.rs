//! Router construction for the FHE HTTP API.

use axum::{
    extract::DefaultBodyLimit,
    http::StatusCode,
    middleware,
    routing::{get, post},
    Router,
};
use tower::{limit::ConcurrencyLimitLayer, ServiceBuilder};
use tower_http::{
    compression::CompressionLayer, decompression::RequestDecompressionLayer,
    limit::RequestBodyLimitLayer, timeout::TimeoutLayer,
};

use crate::{auth::internal_auth, routes, settings::Settings};

pub fn build_router(settings: &Settings) -> Router {
    routes::init_cpu_limiter(settings.cpu_concurrency_limit());

    // The body limit applies twice: RequestBodyLimitLayer caps the bytes on the
    // wire, outside the decompressor, and DefaultBodyLimit caps the decompressed
    // size the handler reads. Authentication runs on the route, before the body
    // is read.
    let middleware_stack = ServiceBuilder::new()
        .layer(CompressionLayer::new())
        .layer(RequestBodyLimitLayer::new(settings.body_limit_bytes()))
        .layer(RequestDecompressionLayer::new())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            settings.request_timeout(),
        ))
        .layer(ConcurrencyLimitLayer::new(settings.concurrency_limit()))
        .layer(DefaultBodyLimit::max(settings.body_limit_bytes()));

    let protected = Router::new()
        .route("/keys/register", post(routes::register_key))
        .route("/encrypt-batch", post(routes::encrypt_batch))
        .route("/verify-age-from-dob", post(routes::verify_age_from_dob))
        .route(
            "/verify-liveness-threshold",
            post(routes::verify_liveness_threshold),
        )
        .route_layer(middleware::from_fn_with_state(
            settings.internal_token(),
            internal_auth,
        ))
        .layer(middleware_stack);

    Router::new()
        .route("/health", get(routes::health))
        .route("/build-info", get(routes::build_info))
        .merge(protected)
}
