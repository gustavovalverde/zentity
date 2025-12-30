"""OpenTelemetry setup for the OCR service."""

from __future__ import annotations

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

DEFAULT_OTLP_ENDPOINT = "http://localhost:4318/v1/traces"


def _is_enabled() -> bool:
    return os.getenv("OTEL_ENABLED", "").lower() in {"true", "1", "yes"} or bool(
        os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    )


def _parse_headers(raw: str | None) -> dict[str, str] | None:
    if not raw:
        return None
    headers: dict[str, str] = {}
    for entry in raw.split(","):
        if "=" not in entry:
            continue
        key, value = entry.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and value:
            headers[key] = value
    return headers or None


def _service_name() -> str:
    return os.getenv("OTEL_SERVICE_NAME", "zentity-ocr")


def _service_version() -> str:
    return os.getenv("APP_VERSION") or os.getenv("GIT_SHA", "unknown")


def _environment_name() -> str:
    return os.getenv("APP_ENV") or os.getenv("NODE_ENV") or os.getenv("RUST_ENV") or "development"


def configure_telemetry() -> TracerProvider | None:
    if not _is_enabled():
        return None

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT)
    headers = _parse_headers(os.getenv("OTEL_EXPORTER_OTLP_HEADERS"))

    resource = Resource.create(
        {
            "service.name": _service_name(),
            "service.version": _service_version(),
            "deployment.environment": _environment_name(),
        }
    )

    exporter = OTLPSpanExporter(endpoint=endpoint, headers=headers)
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    return provider


def instrument_app(app) -> None:
    provider = configure_telemetry()
    if not provider:
        return

    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    RequestsInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()
