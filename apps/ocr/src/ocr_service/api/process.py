"""Privacy-preserving document processing endpoint."""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException
from opentelemetry import trace

from ..schemas import (
    IdentityCommitmentsResponse,
    ProcessDocumentRequest,
    ProcessDocumentResponse,
)
from ..services.commitments import generate_identity_commitments, generate_user_salt
from ..services.pipeline import extract_and_validate_document
from .shared import build_extracted_data_response, build_validation_details


def get_router() -> APIRouter:
    router = APIRouter()

    @router.post("/process", response_model=ProcessDocumentResponse)
    async def process_document_endpoint(request: ProcessDocumentRequest):
        if not request.image:
            raise HTTPException(status_code=400, detail="Image is required")

        tracer = trace.get_tracer(__name__)
        start_time = time.time()
        with tracer.start_as_current_span("ocr.process_document") as span:
            span.set_attribute("ocr.image_bytes", len(request.image))
            span.set_attribute("ocr.has_user_salt", bool(request.user_salt))
            result = extract_and_validate_document(request.image)

            validation_issues = list(result.validation_issues)

            commitments_response = None
            if result.extracted and result.extracted.document_number and result.extracted.full_name:
                user_salt = request.user_salt or generate_user_salt()
                identity_commitments = generate_identity_commitments(
                    document_number=result.extracted.document_number,
                    full_name=result.extracted.full_name,
                    user_salt=user_salt,
                    document_type=result.doc_type.value,
                    issuing_country_code=result.extracted.issuing_country_code,
                )
                commitments_response = IdentityCommitmentsResponse(
                    document_hash=identity_commitments.document_hash,
                    name_commitment=identity_commitments.name_commitment,
                    issuing_country_commitment=identity_commitments.issuing_country_commitment,
                    user_salt=identity_commitments.user_salt,
                )
            else:
                if not result.extracted:
                    validation_issues.append("extraction_failed")
                else:
                    if not result.extracted.document_number:
                        validation_issues.append("missing_document_number")
                    if not result.extracted.full_name:
                        validation_issues.append("missing_full_name")

            processing_time_ms = int((time.time() - start_time) * 1000)
            span.set_attribute("ocr.processing_ms", processing_time_ms)
            span.set_attribute("ocr.validation_issue_count", len(validation_issues))

            extracted_response = None
            if result.extracted:
                extracted_response = build_extracted_data_response(result.extracted)

            return ProcessDocumentResponse(
                commitments=commitments_response,
                document_type=result.doc_type.value,
                document_origin=result.document_origin,
                confidence=round(result.confidence, 3),
                extracted_data=extracted_response,
                validation_issues=validation_issues,
                validation_details=build_validation_details(result.validation_details),
                processing_time_ms=processing_time_ms,
            )

    return router
