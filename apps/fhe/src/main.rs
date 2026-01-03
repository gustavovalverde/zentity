//! FHE Service - Homomorphic Encryption HTTP API
//!
//! Provides endpoints for encrypting data and performing age verification
//! using Fully Homomorphic Encryption (TFHE-rs).

use axum::{
    body::Body,
    http::{HeaderMap, Request},
};
use fhe_service::{app::build_router, crypto, settings::Settings, telemetry};
use opentelemetry::{global, propagation::Extractor};
use tower_http::trace::TraceLayer;
use tracing_opentelemetry::OpenTelemetrySpanExt;

struct HeaderExtractor<'a>(&'a HeaderMap);

impl Extractor for HeaderExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|value| value.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|key| key.as_str()).collect()
    }
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    telemetry::init_tracing();

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
        let parent_context =
            global::get_text_map_propagator(|prop| prop.extract(&HeaderExtractor(req.headers())));
        let span = tracing::info_span!(
            "http.request",
            method = %req.method(),
            path = %req.uri().path(),
            request_id = %request_id
        );
        let _ = span.set_parent(parent_context);
        span
    });

    let app = build_router(&settings).layer(trace_layer);

    let addr = settings.socket_addr();
    tracing::info!("FHE Service listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
    telemetry::shutdown_tracing();
}
