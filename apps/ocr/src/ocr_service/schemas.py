"""API request/response schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field
from pydantic.config import ConfigDict


def _to_camel(string: str) -> str:
    parts = string.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:])


class APIModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class ImageRequest(APIModel):
    image: str = Field(..., description="Base64 encoded image")


class ExtractedDataResponse(APIModel):
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    document_number: str | None = None
    date_of_birth: str | None = None
    expiration_date: str | None = None
    nationality: str | None = None
    nationality_code: str | None = None
    issuing_country: str | None = None
    issuing_country_code: str | None = None
    gender: str | None = None


class ValidationDetail(APIModel):
    """Rich validation error details for frontend display."""

    error_code: str = Field(..., description="Machine-readable error code")
    error_message: str = Field(..., description="User-friendly error message")
    validator_used: str | None = Field(
        None, description="Validator module used (e.g., 'stdnum.do.cedula')"
    )
    format_name: str | None = Field(
        None,
        description="Document format name (e.g., 'cedula (DR national ID)')",
    )


class DocumentResponse(APIModel):
    document_type: str = Field(..., description="passport, national_id, drivers_license, unknown")
    document_origin: str | None = Field(
        None, description="Detected country of origin (e.g., 'DOM', 'USA')"
    )
    confidence: float = Field(..., ge=0, le=1)
    extracted_data: ExtractedDataResponse | None = None
    validation_issues: list[str]
    validation_details: list[ValidationDetail] | None = Field(
        None, description="Rich validation error details for frontend display"
    )
    processing_time_ms: int


class ExtractResponse(APIModel):
    text_blocks: list[dict]
    full_text: str
    processing_time_ms: int
    error: str | None = None


class HealthResponse(APIModel):
    status: str
    service: str
    version: str
    uptime_seconds: float


class BuildInfoResponse(APIModel):
    """Build information for deployment verification."""

    service: str
    version: str
    git_sha: str
    build_time: str


class ProcessDocumentRequest(APIModel):
    """Request for full privacy-preserving document processing."""

    image: str = Field(..., description="Base64 encoded document image")
    user_salt: str | None = Field(
        None,
        description="Existing user salt. If not provided, a new one is generated.",
    )


class IdentityCommitmentsResponse(APIModel):
    """Cryptographic commitments derived from document (safe to store)."""

    document_hash: str = Field(..., description="SHA256(doc_number + salt)")
    name_commitment: str = Field(..., description="SHA256(name + salt)")
    issuing_country_commitment: str | None = Field(
        None, description="SHA256(issuing_country_code + salt) - for fraud detection"
    )
    user_salt: str = Field(..., description="User's unique salt (store securely)")


class ProcessDocumentResponse(APIModel):
    """Privacy-preserving document processing response."""

    commitments: IdentityCommitmentsResponse | None = None
    document_type: str
    document_origin: str | None = None
    confidence: float
    extracted_data: ExtractedDataResponse | None = None
    validation_issues: list[str]
    validation_details: list[ValidationDetail] | None = Field(
        None, description="Rich validation error details for frontend display"
    )
    processing_time_ms: int


class VerifyNameRequest(APIModel):
    """Request to verify if a claimed name matches the stored commitment."""

    claimed_name: str = Field(..., description="The name being claimed")
    stored_commitment: str = Field(..., description="The stored name commitment hash")
    user_salt: str = Field(..., description="User's unique salt")


class VerifyNameResponse(APIModel):
    """Response indicating if the claimed name matches."""

    matches: bool = Field(..., description="True if name matches commitment")
