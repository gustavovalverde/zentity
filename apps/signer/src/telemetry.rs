//! OpenTelemetry telemetry integration.
//!
//! This module is only compiled when the `otel` feature is enabled.

use std::sync::OnceLock;

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

/// Global tracer provider for shutdown.
static TRACER_PROVIDER: OnceLock<SdkTracerProvider> = OnceLock::new();

/// Initialize tracing with OpenTelemetry export.
///
/// Exports traces to the OTLP endpoint configured via `OTEL_EXPORTER_OTLP_ENDPOINT`
/// environment variable (defaults to `http://localhost:4318`).
pub fn init_tracing() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "signer_service=info,actix_web=info".into());

    let fmt_layer = tracing_subscriber::fmt::layer();

    // Set up OTLP exporter using HTTP (http-proto feature)
    let otlp_exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_endpoint(
            std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
                .unwrap_or_else(|_| "http://localhost:4318".to_string()),
        )
        .build()
        .expect("Failed to create OTLP exporter");

    // Build resource with service name
    let resource = opentelemetry_sdk::Resource::builder()
        .with_service_name("signer-service")
        .build();

    // Build tracer provider
    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(otlp_exporter)
        .with_resource(resource)
        .build();

    // Get a tracer from the provider
    let tracer = tracer_provider.tracer("signer-service");
    let otel_layer = OpenTelemetryLayer::new(tracer);

    // Store provider for shutdown
    let _ = TRACER_PROVIDER.set(tracer_provider.clone());

    // Set global tracer provider
    opentelemetry::global::set_tracer_provider(tracer_provider);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .with(otel_layer)
        .init();
}

/// Shutdown OpenTelemetry and flush remaining spans.
pub fn shutdown_tracing() {
    if let Some(provider) = TRACER_PROVIDER.get()
        && let Err(e) = provider.shutdown()
    {
        tracing::error!("Error shutting down tracer provider: {e:?}");
    }
}
