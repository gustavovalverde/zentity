//! OpenTelemetry tracing setup for the FHE service.

use std::env;

use once_cell::sync::OnceCell;
use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use opentelemetry_semantic_conventions::resource::{SERVICE_NAME, SERVICE_VERSION};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

static TRACER_PROVIDER: OnceCell<SdkTracerProvider> = OnceCell::new();

fn is_enabled() -> bool {
    if let Ok(enabled) = env::var("OTEL_ENABLED") {
        if matches!(enabled.as_str(), "true" | "1" | "yes") {
            return true;
        }
    }
    env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn service_name() -> String {
    env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "zentity-fhe".to_string())
}

fn service_version() -> String {
    env::var("APP_VERSION").unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string())
}

fn deployment_environment() -> String {
    env::var("APP_ENV")
        .or_else(|_| env::var("NODE_ENV"))
        .or_else(|_| env::var("RUST_ENV"))
        .unwrap_or_else(|_| "development".to_string())
}

pub fn init_tracing() {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "fhe_service=info,tower_http=debug".into());
    let fmt_layer = tracing_subscriber::fmt::layer();

    if !is_enabled() {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .init();
        return;
    }

    global::set_text_map_propagator(TraceContextPropagator::new());

    let mut exporter_builder = opentelemetry_otlp::SpanExporter::builder().with_http();
    if let Ok(endpoint) = env::var("OTEL_EXPORTER_OTLP_ENDPOINT") {
        let endpoint = endpoint.trim();
        if !endpoint.is_empty() {
            exporter_builder = exporter_builder.with_endpoint(endpoint.to_string());
        }
    }

    let exporter = exporter_builder
        .build()
        .expect("Failed to initialize OTLP exporter");

    let resource = Resource::builder()
        .with_attribute(KeyValue::new(SERVICE_NAME, service_name()))
        .with_attribute(KeyValue::new(SERVICE_VERSION, service_version()))
        .with_attribute(KeyValue::new(
            "deployment.environment.name",
            deployment_environment(),
        ))
        .build();

    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource)
        .build();

    let _ = TRACER_PROVIDER.set(tracer_provider.clone());
    global::set_tracer_provider(tracer_provider.clone());
    let tracer = tracer_provider.tracer("fhe_service");
    let otel_layer = OpenTelemetryLayer::new(tracer);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .with(otel_layer)
        .init();
}

pub fn shutdown_tracing() {
    if let Some(provider) = TRACER_PROVIDER.get() {
        if let Err(err) = provider.shutdown() {
            tracing::warn!("Failed to shutdown tracer provider: {err}");
        }
    }
}
