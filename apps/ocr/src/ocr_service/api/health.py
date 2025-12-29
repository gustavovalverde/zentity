"""Health and build info endpoints."""

from __future__ import annotations

import time

from fastapi import APIRouter

from ..schemas import BuildInfoResponse, HealthResponse
from ..settings import Settings


def get_router(settings: Settings) -> APIRouter:
    start_time = time.time()
    router = APIRouter()

    @router.get("/health", response_model=HealthResponse)
    async def health_check():
        return HealthResponse(
            status="healthy",
            service="ocr-service",
            version=settings.version,
            uptime_seconds=round(time.time() - start_time, 2),
        )

    @router.get("/build-info", response_model=BuildInfoResponse)
    async def build_info():
        return BuildInfoResponse(
            service="ocr-service",
            version=settings.version,
            git_sha=settings.git_sha,
            build_time=settings.build_time,
        )

    return router
