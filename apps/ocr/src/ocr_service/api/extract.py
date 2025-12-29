"""Raw OCR extraction endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas import ExtractResponse, ImageRequest
from ..services.ocr_engine import extract_text_from_base64


def get_router() -> APIRouter:
    router = APIRouter()

    @router.post("/extract", response_model=ExtractResponse)
    async def extract_text_endpoint(request: ImageRequest):
        if not request.image:
            raise HTTPException(status_code=400, detail="Image is required")

        result = extract_text_from_base64(request.image)

        return ExtractResponse(
            text_blocks=[
                {"text": block.text, "confidence": block.confidence, "bbox": block.bbox}
                for block in result.text_blocks
            ],
            full_text=result.full_text,
            processing_time_ms=result.processing_time_ms,
            error=result.error,
        )

    return router
