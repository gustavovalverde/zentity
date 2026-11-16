//! OpenTelemetry tracing setup for the FHE service.

use std::env;

use once_cell::sync::OnceCell;
use opentelemetry::global;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::SpanExporter;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{SdkTracer, SdkTracerProvider};
use opentelemetry_sdk::Resource;
use opentelemetry_semantic_conventions::resource::{
    DEPLOYMENT_ENVIRONMENT_NAME, SERVICE_NAME, SERVICE_VERSION,
};
use tracing::Subscriber;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{
    layer::SubscriberExt, registry::LookupSpan, util::SubscriberInitExt, EnvFilter,
};

static TRACER_PROVIDER: OnceCell<SdkTracerProvider> = OnceCell::new();

fn has_value(name: &str) -> bool {
    env::var(name)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn is_enabled() -> bool {
    if let Ok(enabled) = env::var("OTEL_ENABLED") {
        if matches!(enabled.as_str(), "true" | "1" | "yes") {
            return true;
        }
    }
    has_value("OTEL_EXPORTER_OTLP_ENDPOINT") || has_value("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
}

/// The exporter takes no explicit endpoint, so `opentelemetry-otlp` resolves
/// `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` as given, else `OTEL_EXPORTER_OTLP_ENDPOINT`
/// plus `/v1/traces`, and reads `OTEL_EXPORTER_OTLP_HEADERS`.
fn span_exporter() -> SpanExporter {
    SpanExporter::builder()
        .with_http()
        .build()
        .expect("Failed to initialize OTLP exporter")
}

fn service_name() -> String {
    env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "zentity-fhe".to_string())
}

/// The build's git commit, embedded by `build.rs` from `GIT_SHA` (or `git rev-parse`).
fn service_version() -> String {
    env!("GIT_SHA").to_string()
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

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .with(is_enabled().then(otel_layer))
        .init();
}

fn otel_layer<S>() -> OpenTelemetryLayer<S, SdkTracer>
where
    S: Subscriber + for<'span> LookupSpan<'span>,
{
    global::set_text_map_propagator(TraceContextPropagator::new());

    let exporter = span_exporter();

    let resource = Resource::builder()
        .with_attribute(KeyValue::new(SERVICE_NAME, service_name()))
        .with_attribute(KeyValue::new(SERVICE_VERSION, service_version()))
        .with_attribute(KeyValue::new(
            DEPLOYMENT_ENVIRONMENT_NAME,
            deployment_environment(),
        ))
        .build();

    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource)
        .build();

    let _ = TRACER_PROVIDER.set(tracer_provider.clone());
    global::set_tracer_provider(tracer_provider.clone());
    OpenTelemetryLayer::new(tracer_provider.tracer("fhe_service"))
}

pub fn shutdown_tracing() {
    if let Some(provider) = TRACER_PROVIDER.get() {
        if let Err(err) = provider.shutdown() {
            tracing::warn!("Failed to shutdown tracer provider: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{self, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Mutex, MutexGuard};
    use std::thread;
    use std::time::{Duration, Instant};

    use opentelemetry::trace::Tracer;

    use super::*;

    const VARS: [&str; 3] = [
        "OTEL_ENABLED",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    ];

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn clean_env() -> MutexGuard<'static, ()> {
        let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        for name in VARS {
            env::remove_var(name);
        }
        guard
    }

    #[test]
    fn service_version_is_the_build_commit() {
        let _env = clean_env();
        env::set_var("APP_VERSION", "9.9.9");
        assert_eq!(service_version(), env!("GIT_SHA"));
        env::remove_var("APP_VERSION");
    }

    #[test]
    fn disabled_without_gate_or_endpoint() {
        let _env = clean_env();
        assert!(!is_enabled());
        env::set_var("OTEL_EXPORTER_OTLP_ENDPOINT", "  ");
        assert!(!is_enabled());
    }

    #[test]
    fn enabled_by_otel_enabled() {
        let _env = clean_env();
        env::set_var("OTEL_ENABLED", "true");
        assert!(is_enabled());
    }

    #[test]
    fn enabled_by_base_endpoint_alone() {
        let _env = clean_env();
        env::set_var("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318");
        assert!(is_enabled());
    }

    #[test]
    fn enabled_by_traces_endpoint_alone() {
        let _env = clean_env();
        env::set_var(
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            "http://collector:4318/v1/traces",
        );
        assert!(is_enabled());
    }

    /// Exports one span through `span_exporter` to a local listener and returns
    /// the request path the listener saw. `endpoint_var` is set to the listener's
    /// URL plus `suffix`. The test fails if no request arrives within 10 seconds.
    fn exported_request_path(endpoint_var: &str, suffix: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        listener.set_nonblocking(true).expect("nonblocking");
        env::set_var(endpoint_var, format!("http://127.0.0.1:{port}{suffix}"));

        let server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(err) if err.kind() == io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "no export request received");
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(err) => panic!("accept: {err}"),
                }
            };
            stream.set_nonblocking(false).expect("blocking stream");
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .expect("read timeout");
            let mut head = Vec::new();
            let mut buf = [0u8; 1024];
            while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = stream.read(&mut buf).expect("read");
                if n == 0 {
                    break;
                }
                head.extend_from_slice(&buf[..n]);
            }
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            let head = String::from_utf8_lossy(&head).into_owned();
            head.split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_owned()
        });

        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(span_exporter())
            .build();
        provider.tracer("test").start("span");
        let path = server.join().expect("server thread");
        let _ = provider.shutdown();
        path
    }

    #[test]
    fn base_endpoint_exports_to_v1_traces_once() {
        let _env = clean_env();
        assert_eq!(
            exported_request_path("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
            "/v1/traces"
        );
    }

    #[test]
    fn traces_endpoint_is_used_as_given() {
        let _env = clean_env();
        assert_eq!(
            exported_request_path("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "/custom/spans"),
            "/custom/spans"
        );
    }
}
