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
        let provided = req
            .headers()
            .get("x-zentity-internal-token")
            .and_then(|value| value.to_str().ok());
        if provided != Some(expected.as_str()) {
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

    // Initialize crypto keys (this can take a while on first run)
    tracing::info!("Initializing FHE keys (this may take ~30-60s on first run)...");
    crypto::init_keys();
    tracing::info!("FHE keys initialized successfully");

    let internal_token = std::env::var("INTERNAL_SERVICE_TOKEN")
        .ok()
        .filter(|value| !value.is_empty());

    let enable_keygen_endpoint = std::env::var("ENABLE_KEYGEN_ENDPOINT")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    // Build router
    let mut app = Router::new()
        .route("/health", get(routes::health))
        .route("/build-info", get(routes::build_info));

    if enable_keygen_endpoint {
        app = app.route("/keys/generate", post(routes::generate_keys));
    }

    let app = app
        // Birth year encryption (u16)
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
        .route(
            "/verify-liveness-threshold",
            post(routes::verify_liveness_threshold),
        )
        .layer(middleware::from_fn_with_state(
            internal_token,
            internal_auth,
        ))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
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
