"""Internal service authentication middleware."""

from __future__ import annotations

import logging
import secrets

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette import status

from .logging import set_request_id

logger = logging.getLogger(__name__)

_PUBLIC_PATHS = frozenset({"/health", "/build-info", "/openapi.json"})


def _is_public_path(path: str) -> bool:
    return (
        path in _PUBLIC_PATHS
        or path.startswith("/docs")
        or path.startswith("/redoc")
        or path.startswith("/docs/oauth2-redirect")
    )


def _validate_internal_token(provided: str | None, expected: str) -> bool:
    if not expected:
        return True
    if not provided:
        return False
    return secrets.compare_digest(provided, expected)


def _mask_ip(ip: str) -> str:
    if not ip:
        return "unknown"
    if ":" in ip:
        parts = ip.split(":")
        return ":".join(parts[:3]) + ":…"
    parts = ip.split(".")
    if len(parts) == 4:
        return f"{parts[0]}.{parts[1]}.x.x"
    return "unknown"


def add_internal_auth_middleware(app: FastAPI, *, token: str) -> None:
    """Attach auth middleware when a token is configured."""
    if not token:
        return

    @app.middleware("http")
    async def internal_auth_middleware(request: Request, call_next):
        set_request_id(
            request.headers.get("x-request-id") or request.headers.get("x-correlation-id")
        )
        if _is_public_path(request.url.path):
            return await call_next(request)

        provided = request.headers.get("x-zentity-internal-token")
        if not _validate_internal_token(provided, token):
            client_host = request.client.host if request.client else ""
            logger.warning(
                "Unauthorized access attempt to %s from %s",
                request.url.path,
                _mask_ip(client_host),
            )
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "Unauthorized"},
            )

        return await call_next(request)
