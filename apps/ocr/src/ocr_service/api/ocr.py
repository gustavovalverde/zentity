"""Structured OCR endpoint."""

from __future__ import annotations

import time

from fastapi import APIRouter

from ..schemas import DocumentResponse, ImageRequest
from ..services.pipeline import extract_and_validate_document


def get_router() -> APIRouter:
    router = APIRouter()

    @router.post("/ocr", response_model=DocumentResponse)
    async def ocr_document_endpoint(request: ImageRequest):
        start_time = time.time()
        result = extract_and_validate_document(request.image)
        processing_time_ms = int((time.time() - start_time) * 1000)

        return DocumentResponse(
            document_type=result.doc_type.value,
            document_origin=result.document_origin,
            confidence=round(result.confidence, 3),
            extracted_data=result.extracted,
            validation_issues=result.validation_issues,
            validation_details=result.validation_details or None,
            processing_time_ms=processing_time_ms,
        )

    return router
