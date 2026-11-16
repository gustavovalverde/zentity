"""Tests for OTLP endpoint resolution and enablement in the OCR telemetry setup."""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from opentelemetry import trace

from ocr_service import telemetry

OTEL_VARS = (
    "OTEL_ENABLED",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS",
)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in OTEL_VARS:
        monkeypatch.delenv(name, raising=False)


class _Collector:
    """Local HTTP server that records the request paths it receives."""

    def __init__(self) -> None:
        self.paths: list[str] = []
        paths = self.paths

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                paths.append(self.path)
                self.send_response(200)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> _Collector:
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self.server.shutdown()
        self.server.server_close()


def _export_one_span() -> None:
    provider = telemetry.configure_telemetry()
    assert provider is not None
    with provider.get_tracer("test").start_as_current_span("span"):
        pass
    provider.force_flush()
    provider.shutdown()


@pytest.fixture(autouse=True)
def restore_tracer_provider(monkeypatch):
    # set_tracer_provider may only be called once per process; keep tests independent.
    monkeypatch.setattr(trace, "set_tracer_provider", lambda provider: None)


def test_service_version_is_the_build_commit(monkeypatch):
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    monkeypatch.setenv("GIT_SHA", "abc123")
    assert telemetry._service_version() == "abc123"
    monkeypatch.delenv("GIT_SHA")
    assert telemetry._service_version() == "unknown"


def test_disabled_without_gate_or_endpoint():
    assert telemetry.configure_telemetry() is None


def test_whitespace_endpoint_does_not_enable(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "  ")
    assert telemetry.configure_telemetry() is None


def test_enabled_by_otel_enabled(monkeypatch):
    monkeypatch.setenv("OTEL_ENABLED", "true")
    assert telemetry.configure_telemetry() is not None


def test_enabled_by_base_endpoint_alone(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")
    assert telemetry.configure_telemetry() is not None


def test_enabled_by_traces_endpoint_alone(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://collector:4318/v1/traces")
    assert telemetry.configure_telemetry() is not None


def test_base_endpoint_exports_to_v1_traces_once(monkeypatch):
    with _Collector() as collector:
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.url)
        _export_one_span()
    assert collector.paths == ["/v1/traces"]


def test_traces_endpoint_is_used_as_given(monkeypatch):
    with _Collector() as collector:
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://unused.invalid:4318")
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", f"{collector.url}/custom/traces")
        _export_one_span()
    assert collector.paths == ["/custom/traces"]
