"""Shared API helpers for response mapping."""

from __future__ import annotations

from ..schemas import ExtractedDataResponse, ValidationDetail
from ..services.parser import ExtractedData
from ..services.validators import ValidationResult


def build_extracted_data_response(extracted: ExtractedData) -> ExtractedDataResponse:
    return ExtractedDataResponse(
        full_name=extracted.full_name,
        first_name=extracted.first_name,
        last_name=extracted.last_name,
        document_number=extracted.document_number,
        date_of_birth=extracted.date_of_birth,
        expiration_date=extracted.expiration_date,
        nationality=extracted.nationality,
        nationality_code=extracted.nationality_code,
        issuing_country=extracted.issuing_country,
        issuing_country_code=extracted.issuing_country_code,
        gender=extracted.gender,
    )


def build_validation_details(
    details: list[ValidationResult],
) -> list[ValidationDetail] | None:
    if not details:
        return None
    mapped = [
        ValidationDetail(
            error_code=detail.error_code,
            error_message=detail.error_message,
            validator_used=detail.validator_used,
            format_name=detail.format_name,
        )
        for detail in details
        if detail.error_code and detail.error_message
    ]
    return mapped or None
