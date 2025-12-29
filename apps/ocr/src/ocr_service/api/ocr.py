"""Structured OCR endpoint."""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException

from ..schemas import DocumentResponse, ImageRequest
from ..services.pipeline import extract_and_validate_document
from .shared import build_extracted_data_response, build_validation_details


def get_router() -> APIRouter:
    router = APIRouter()

    @router.post("/ocr", response_model=DocumentResponse)
    async def ocr_document_endpoint(request: ImageRequest):
        if not request.image:
            raise HTTPException(status_code=400, detail="Image is required")

        start_time = time.time()
        result = extract_and_validate_document(request.image)
        processing_time_ms = int((time.time() - start_time) * 1000)

        extracted_response = None
        if result.extracted:
            extracted_response = build_extracted_data_response(result.extracted)

        return DocumentResponse(
            document_type=result.doc_type.value,
            document_origin=result.document_origin,
            confidence=round(result.confidence, 3),
            extracted_data=extracted_response,
            validation_issues=result.validation_issues,
            validation_details=build_validation_details(result.validation_details),
            processing_time_ms=processing_time_ms,
        )

    return router
