//! FHE Service - Homomorphic Encryption HTTP API
//!
//! Provides endpoints for encrypting data and performing age verification
//! using Fully Homomorphic Encryption (TFHE-rs).

use axum::{body::Body, http::Request};
use fhe_service::{app::build_router, crypto, settings::Settings};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

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

    let settings = Settings::from_env();
    if let Err(message) = settings.validate() {
        tracing::error!("{message}");
        std::process::exit(1);
    }

    // Initialize crypto keys (loads persisted server keys if available)
    tracing::info!("Initializing FHE server key store...");
    crypto::init_keys();
    tracing::info!("FHE keys initialized successfully");

    if settings.internal_token().is_some() {
        tracing::info!("Authentication enabled (INTERNAL_SERVICE_TOKEN configured)");
    } else {
        tracing::warn!("Running without authentication (INTERNAL_SERVICE_TOKEN not set)");
    }

    tracing::info!("FHE body limit set to {} MB", settings.body_limit_mb());

    let trace_layer = TraceLayer::new_for_http().make_span_with(|req: &Request<Body>| {
        let request_id = req
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("-");
        tracing::info_span!(
            "http.request",
            method = %req.method(),
            path = %req.uri().path(),
            request_id = %request_id
        )
    });

    let app = build_router(&settings).layer(trace_layer);

    let addr = settings.socket_addr();
    tracing::info!("FHE Service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
