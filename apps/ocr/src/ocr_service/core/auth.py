"""Internal service authentication middleware."""

from __future__ import annotations

import logging
import secrets

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette import status

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


def add_internal_auth_middleware(app: FastAPI, *, token: str) -> None:
    """Attach auth middleware when a token is configured."""
    if not token:
        return

    @app.middleware("http")
    async def internal_auth_middleware(request: Request, call_next):
        if _is_public_path(request.url.path):
            return await call_next(request)

        provided = request.headers.get("x-zentity-internal-token")
        if not _validate_internal_token(provided, token):
            logger.warning(
                "Unauthorized access attempt to %s from %s",
                request.url.path,
                request.client.host if request.client else "unknown",
            )
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "Unauthorized"},
            )

        return await call_next(request)
