"""OpenTelemetry setup for the OCR service."""

from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def _has_value(name: str) -> bool:
    return bool(os.getenv(name, "").strip())


def _is_enabled() -> bool:
    return (
        os.getenv("OTEL_ENABLED", "").lower() in {"true", "1", "yes"}
        or _has_value("OTEL_EXPORTER_OTLP_ENDPOINT")
        or _has_value("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    )


def _service_version() -> str:
    return os.getenv("APP_VERSION") or os.getenv("GIT_SHA", "unknown")


def _environment_name() -> str:
    return os.getenv("APP_ENV") or os.getenv("NODE_ENV") or os.getenv("RUST_ENV") or "development"


def configure_telemetry() -> TracerProvider | None:
    if not _is_enabled():
        return None

    # Resource.create reads OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES. The exporter reads
    # OTEL_EXPORTER_OTLP_TRACES_ENDPOINT as given, else OTEL_EXPORTER_OTLP_ENDPOINT plus
    # /v1/traces, and OTEL_EXPORTER_OTLP_HEADERS.
    resource = Resource.create(
        {
            "service.version": _service_version(),
            "deployment.environment": _environment_name(),
        }
    )

    exporter = OTLPSpanExporter()
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    return provider


def instrument_app(app) -> None:
    provider = configure_telemetry()
    if not provider:
        return

    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
