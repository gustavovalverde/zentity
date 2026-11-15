"""
Unit tests for the API response schemas.

The wire format (camelCase JSON names) is consumed by the web client, so these tests pin
the field names and the mapping from the service dataclasses.
"""

from dataclasses import asdict

from ocr_service.schemas import (
    DocumentResponse,
    ExtractResponse,
    ProcessDocumentResponse,
)
from ocr_service.services.commitments import IdentityCommitments
from ocr_service.services.ocr_engine import TextBlock
from ocr_service.services.parser import ExtractedData
from ocr_service.services.validators import ValidationResult

EXTRACTED = ExtractedData(
    full_name="Ana Perez",
    first_name="Ana",
    last_name="Perez",
    document_number="001-1234567-8",
    date_of_birth="1990-05-15",
    expiration_date="2030-01-01",
    nationality="Dominican Republic",
    nationality_code="DOM",
    issuing_country="Dominican Republic",
    issuing_country_code="DOM",
    gender="F",
)
DETAIL = ValidationResult(
    is_valid=False,
    error_code="invalid_document_checksum",
    error_message="Bad check digit.",
    validator_used="stdnum.do.cedula",
    format_name="Cedula",
)


class TestResponseMapping:
    def test_document_response_wire_names(self):
        response = DocumentResponse(
            document_type="national_id",
            confidence=0.9,
            extracted_data=EXTRACTED,
            validation_issues=["invalid_document_checksum"],
            validation_details=[DETAIL],
            processing_time_ms=12,
        )
        data = response.model_dump(by_alias=True)

        assert set(data["extractedData"]) == {
            "fullName",
            "firstName",
            "lastName",
            "documentNumber",
            "dateOfBirth",
            "expirationDate",
            "nationality",
            "nationalityCode",
            "issuingCountry",
            "issuingCountryCode",
            "gender",
        }
        assert data["extractedData"]["documentNumber"] == "001-1234567-8"
        assert data["validationDetails"] == [
            {
                "errorCode": "invalid_document_checksum",
                "errorMessage": "Bad check digit.",
                "validatorUsed": "stdnum.do.cedula",
                "formatName": "Cedula",
            }
        ]
        assert data["processingTimeMs"] == 12

    def test_process_response_exposes_commitments_with_salt(self):
        commitments = IdentityCommitments(
            document_hash="a" * 64,
            name_commitment="b" * 64,
            user_salt="c" * 64,
            document_type="national_id",
            issuing_country_commitment="d" * 64,
        )
        response = ProcessDocumentResponse(
            commitments=commitments,
            document_type="national_id",
            confidence=0.9,
            validation_issues=[],
            processing_time_ms=1,
        )

        assert response.model_dump(by_alias=True)["commitments"] == {
            "documentHash": "a" * 64,
            "nameCommitment": "b" * 64,
            "issuingCountryCommitment": "d" * 64,
            "userSalt": "c" * 64,
        }

    def test_extract_response_text_blocks_are_plain_dicts(self):
        bbox = [[0, 0], [1, 0], [1, 1], [0, 1]]
        block = TextBlock(text="hi", confidence=0.5, bbox=bbox)
        response = ExtractResponse(
            text_blocks=[asdict(block)], full_text="hi", processing_time_ms=1
        )

        assert response.model_dump(by_alias=True)["textBlocks"] == [
            {"text": "hi", "confidence": 0.5, "bbox": bbox}
        ]
