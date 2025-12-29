//! FHE Service - Homomorphic Encryption HTTP API
//!
//! Provides endpoints for encrypting data and performing age verification
//! using Fully Homomorphic Encryption (TFHE-rs).

mod crypto;
mod error;
mod routes;

use axum::{
    body::Body,
    extract::DefaultBodyLimit,
    extract::State,
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

async fn internal_auth(
    State(token): State<Option<String>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // Allow public endpoints without auth
    let public_paths = ["/health", "/build-info"];
    if public_paths.contains(&req.uri().path()) {
        return next.run(req).await;
    }

    if let Some(expected) = token.as_ref().filter(|value| !value.is_empty()) {
        // Token configured: enforce authentication
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

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fhe_service=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting FHE Service...");

    // Initialize crypto keys (loads persisted server keys if available)
    tracing::info!("Initializing FHE server key store...");
    crypto::init_keys();
    tracing::info!("FHE keys initialized successfully");

    let internal_token = std::env::var("INTERNAL_SERVICE_TOKEN")
        .ok()
        .filter(|value| !value.is_empty());

    let node_env = std::env::var("NODE_ENV").unwrap_or_default();
    let app_env = std::env::var("APP_ENV").unwrap_or_default();
    let rust_env = std::env::var("RUST_ENV").unwrap_or_default();
    let require_internal_token = matches!(node_env.as_str(), "production")
        || matches!(app_env.as_str(), "production")
        || matches!(rust_env.as_str(), "production")
        || matches!(
            std::env::var("INTERNAL_SERVICE_TOKEN_REQUIRED")
                .unwrap_or_default()
                .to_lowercase()
                .as_str(),
            "1" | "true" | "yes"
        );

    if internal_token.is_some() {
        tracing::info!("Authentication enabled (INTERNAL_SERVICE_TOKEN configured)");
    } else if require_internal_token {
        tracing::error!(
            "INTERNAL_SERVICE_TOKEN is required in production. Set INTERNAL_SERVICE_TOKEN or INTERNAL_SERVICE_TOKEN_REQUIRED=0."
        );
        std::process::exit(1);
    } else {
        tracing::warn!("Running without authentication (INTERNAL_SERVICE_TOKEN not set)");
    }

    let body_limit_mb: usize = std::env::var("FHE_BODY_LIMIT_MB")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(64);
    let body_limit_bytes = body_limit_mb.saturating_mul(1024 * 1024);
    tracing::info!("FHE body limit set to {} MB", body_limit_mb);

    // Build router
    let app = Router::new()
        .route("/health", get(routes::health))
        .route("/build-info", get(routes::build_info))
        .route("/keys/register", post(routes::register_key))
        // Birth year offset encryption (years since 1900)
        .route(
            "/encrypt-birth-year-offset",
            post(routes::encrypt_birth_year_offset),
        )
        .route("/verify-age-offset", post(routes::verify_age_offset))
        // Country code + compliance level encryption
        .route("/encrypt-country-code", post(routes::encrypt_country_code))
        .route(
            "/encrypt-compliance-level",
            post(routes::encrypt_compliance_level),
        )
        // Liveness score encryption (0.0-1.0 as u16)
        .route("/encrypt-liveness", post(routes::encrypt_liveness))
        .route(
            "/verify-liveness-threshold",
            post(routes::verify_liveness_threshold),
        )
        .layer(middleware::from_fn_with_state(
            internal_token,
            internal_auth,
        ))
        .layer(DefaultBodyLimit::max(body_limit_bytes))
        .layer(TraceLayer::new_for_http());

    // Get port from environment or default to 5001
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5001);

    let host: IpAddr = std::env::var("HOST")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(IpAddr::V6(Ipv6Addr::UNSPECIFIED));

    let addr = SocketAddr::new(host, port);
    tracing::info!("FHE Service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
