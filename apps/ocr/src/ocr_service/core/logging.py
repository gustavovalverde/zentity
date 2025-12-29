"""Structured logging helpers with request correlation."""

from __future__ import annotations

import contextvars
import logging
from uuid import uuid4

_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    """Inject request_id into log records."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D401 - standard filter
        record.request_id = _request_id.get("-")
        return True


def set_request_id(value: str | None = None) -> str:
    """Set (or generate) the current request id for logging."""
    request_id = value or str(uuid4())
    _request_id.set(request_id)
    return request_id


def get_request_id() -> str:
    """Get the current request id (or '-' if unset)."""
    return _request_id.get("-")


def configure_logging() -> None:
    """Attach request id filter and ensure format includes it."""
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(level=logging.INFO)

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] [req:%(request_id)s] %(message)s"
    )

    for handler in root.handlers:
        handler.addFilter(RequestIdFilter())
        handler.setFormatter(formatter)

    # Ensure module loggers inherit the filter/format
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        for handler in logger.handlers:
            handler.addFilter(RequestIdFilter())
            handler.setFormatter(formatter)
