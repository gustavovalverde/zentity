"""Raw OCR extraction endpoint."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter

from ..schemas import ExtractResponse, ImageRequest
from ..services.ocr_engine import extract_text_from_base64


def get_router() -> APIRouter:
    router = APIRouter()

    @router.post("/extract", response_model=ExtractResponse)
    async def extract_text_endpoint(request: ImageRequest):
        result = extract_text_from_base64(request.image)

        return ExtractResponse(
            text_blocks=[asdict(block) for block in result.text_blocks],
            full_text=result.full_text,
            processing_time_ms=result.processing_time_ms,
            error=result.error,
        )

    return router
