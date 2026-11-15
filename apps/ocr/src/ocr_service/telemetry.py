"""OpenTelemetry setup for the OCR service."""

from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

DEFAULT_OTLP_ENDPOINT = "http://localhost:4318/v1/traces"


def _is_enabled() -> bool:
    return os.getenv("OTEL_ENABLED", "").lower() in {"true", "1", "yes"} or bool(
        os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    )


def _service_version() -> str:
    return os.getenv("APP_VERSION") or os.getenv("GIT_SHA", "unknown")


def _environment_name() -> str:
    return os.getenv("APP_ENV") or os.getenv("NODE_ENV") or os.getenv("RUST_ENV") or "development"


def configure_telemetry() -> TracerProvider | None:
    if not _is_enabled():
        return None

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT)

    # Resource.create reads OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES, and the exporter
    # reads OTEL_EXPORTER_OTLP_HEADERS. The endpoint stays explicit because this repo's shared
    # OTEL_EXPORTER_OTLP_ENDPOINT is the full traces URL, not the SDK's base URL.
    resource = Resource.create(
        {
            "service.version": _service_version(),
            "deployment.environment": _environment_name(),
        }
    )

    exporter = OTLPSpanExporter(endpoint=endpoint)
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    return provider


def instrument_app(app) -> None:
    provider = configure_telemetry()
    if not provider:
        return

    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
