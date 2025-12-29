"""Shared OCR -> parse -> validate pipeline for document processing."""

from __future__ import annotations

from dataclasses import dataclass

from .document_detector import DocumentType, detect_document_type
from .ocr_engine import TextBlock, extract_document_text_from_base64
from .parser import (
    ExtractedData,
    extract_drivers_license_fields,
    extract_national_id_fields,
    extract_passport_fields,
)
from .validators import (
    ValidationResult,
    calculate_confidence,
    validate_dob,
    validate_expiration_date,
    validate_national_id_detailed,
    validate_passport_number,
)

MIN_OCR_TEXT_LENGTH = 10


@dataclass(frozen=True)
class DocumentExtractionResult:
    extracted: ExtractedData | None
    doc_type: DocumentType
    validation_issues: list[str]
    validation_details: list[ValidationResult]
    confidence: float
    document_origin: str | None
    ocr_error: str | None = None


def _validate_national_id(
    extracted: ExtractedData,
    validation_issues: list[str],
    validation_details: list[ValidationResult],
) -> None:
    if extracted.document_number and extracted.nationality_code:
        result = validate_national_id_detailed(
            extracted.document_number, extracted.nationality_code
        )
        if result.error_code:
            validation_issues.append(result.error_code)
            if result.error_message:
                validation_details.append(result)


def _validate_passport(
    extracted: ExtractedData,
    mrz_valid: bool,
    validation_issues: list[str],
) -> None:
    if not mrz_valid:
        validation_issues.append("mrz_checksum_invalid")
    if extracted.document_number:
        validation_issues.extend(validate_passport_number(extracted.document_number))


def _validate_dates(extracted: ExtractedData, validation_issues: list[str]) -> None:
    if extracted.expiration_date:
        validation_issues.extend(validate_expiration_date(extracted.expiration_date))
    if extracted.date_of_birth:
        validation_issues.extend(validate_dob(extracted.date_of_birth))


def _calculate_fields_count(extracted: ExtractedData | None) -> int:
    if not extracted:
        return 0
    return sum(
        1
        for value in [
            extracted.full_name,
            extracted.document_number,
            extracted.date_of_birth,
            extracted.expiration_date,
        ]
        if value
    )


def _average_confidence(text_blocks: list[TextBlock]) -> float:
    if not text_blocks:
        return 0.0
    return sum(block.confidence for block in text_blocks) / len(text_blocks)


def extract_and_validate_document(image_base64: str) -> DocumentExtractionResult:
    """
    Extract document data from image and validate fields.

    Shared logic between /ocr and /process endpoints.
    """
    validation_issues: list[str] = []
    validation_details: list[ValidationResult] = []

    ocr_result = extract_document_text_from_base64(image_base64)
    if ocr_result.error:
        return DocumentExtractionResult(
            extracted=None,
            doc_type=DocumentType.UNKNOWN,
            validation_issues=["ocr_failed", ocr_result.error],
            validation_details=[],
            confidence=0.0,
            document_origin=None,
            ocr_error=ocr_result.error,
        )

    full_text = ocr_result.full_text or ""
    if not full_text or len(full_text) < MIN_OCR_TEXT_LENGTH:
        return DocumentExtractionResult(
            extracted=None,
            doc_type=DocumentType.UNKNOWN,
            validation_issues=["no_text_detected"],
            validation_details=[],
            confidence=0.0,
            document_origin=None,
        )

    doc_type, _ = detect_document_type(full_text)

    extracted: ExtractedData | None = None
    if doc_type == DocumentType.NATIONAL_ID:
        extracted = extract_national_id_fields(full_text)
        _validate_national_id(extracted, validation_issues, validation_details)
    elif doc_type == DocumentType.PASSPORT:
        extracted, mrz_valid = extract_passport_fields(full_text)
        _validate_passport(extracted, mrz_valid, validation_issues)
    elif doc_type == DocumentType.DRIVERS_LICENSE:
        extracted = extract_drivers_license_fields(full_text)

    if extracted:
        _validate_dates(extracted, validation_issues)

    fields_count = _calculate_fields_count(extracted)
    confidence = calculate_confidence(
        len(full_text),
        fields_count,
        _average_confidence(ocr_result.text_blocks),
    )

    document_origin = None
    if extracted:
        document_origin = extracted.issuing_country_code or extracted.nationality_code

    return DocumentExtractionResult(
        extracted=extracted,
        doc_type=doc_type,
        validation_issues=validation_issues,
        validation_details=validation_details,
        confidence=confidence,
        document_origin=document_origin,
    )
