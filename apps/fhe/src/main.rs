//! FHE Service - Homomorphic Encryption HTTP API
//!
//! Provides endpoints for encrypting data and performing age verification
//! using Fully Homomorphic Encryption (TFHE-rs).

mod crypto;
mod error;
mod routes;

use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
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

    // Initialize crypto keys (this can take a while on first run)
    tracing::info!("Initializing FHE keys (this may take ~30-60s on first run)...");
    crypto::init_keys();
    tracing::info!("FHE keys initialized successfully");

    // Build router
    let app = Router::new()
        .route("/health", get(routes::health))
        .route("/keys/generate", post(routes::generate_keys))
        // Birth year encryption (legacy, u16)
        .route("/encrypt", post(routes::encrypt))
        .route("/verify-age", post(routes::verify_age))
        // Gender encryption (ISO 5218, u8)
        .route("/encrypt-gender", post(routes::encrypt_gender))
        .route("/verify-gender", post(routes::verify_gender))
        // Full DOB encryption (YYYYMMDD, u32)
        .route("/encrypt-dob", post(routes::encrypt_dob))
        .route("/verify-age-precise", post(routes::verify_age_precise))
        // Liveness score encryption (0.0-1.0 as u16)
        .route("/encrypt-liveness", post(routes::encrypt_liveness))
        .route("/verify-liveness-threshold", post(routes::verify_liveness_threshold))
        .layer(TraceLayer::new_for_http())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    // Get port from environment or default to 5001
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5001);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("FHE Service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
