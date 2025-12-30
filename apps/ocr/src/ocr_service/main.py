"""
OCR Service - FastAPI Application.

Provides REST endpoints for document OCR and field extraction
using RapidOCR with PPOCRv5 for Latin language support.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette import status

from .api import extract, health, ocr, process, verify
from .core.auth import add_internal_auth_middleware
from .core.logging import configure_logging, get_request_id, set_request_id
from .services.ocr_engine import warmup_engine
from .settings import Settings
from .telemetry import instrument_app

configure_logging()
logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.validate()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        logger.info("Warming up RapidOCR engine...")
        warmup_engine()
        logger.info("RapidOCR engine ready")
        yield

    app = FastAPI(
        title="OCR Service",
        description="Document OCR and field extraction for identity documents",
        version=settings.version,
        lifespan=lifespan,
    )

    instrument_app(app)

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or request.headers.get("x-correlation-id")
        set_request_id(request_id)
        response = await call_next(request)
        response.headers["X-Request-Id"] = get_request_id()
        return response

    # Privacy: Avoid echoing request bodies (e.g., base64 images) back in 422 responses.
    @app.exception_handler(RequestValidationError)
    async def request_validation_exception_handler(_request: Request, _exc: RequestValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"error": "Invalid request"},
        )

    add_internal_auth_middleware(app, token=settings.internal_service_token)

    app.include_router(health.get_router(settings))
    app.include_router(extract.get_router())
    app.include_router(ocr.get_router())
    app.include_router(process.get_router())
    app.include_router(verify.get_router())

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=Settings.from_env().port)
