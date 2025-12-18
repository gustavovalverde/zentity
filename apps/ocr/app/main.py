"""
OCR Service - FastAPI Application

Provides REST endpoints for document OCR and field extraction
using RapidOCR with PPOCRv5 for Latin language support.

Privacy-First Architecture:
- Documents are processed transiently (never stored)
- Only cryptographic commitments are returned for storage
- PII is discarded after processing

Endpoints:
- GET  /health     - Service health check
- POST /ocr        - Full document OCR and parsing
- POST /extract    - Raw OCR text extraction only
- POST /process    - Full privacy-preserving document processing
"""

import logging
import os
import subprocess
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette import status

from .commitments import (
    generate_identity_commitments,
    generate_user_salt,
    verify_name_claim,
)
from .document_detector import (
    DocumentType,
    detect_document_type,
)
from .ocr import (
    extract_document_text_from_base64,
    extract_text_from_base64,
    warmup_engine,
)
from .parser import (
    ExtractedData,
    extract_drivers_license_fields,
    extract_national_id_fields,
    extract_passport_fields,
)
from .validators import (
    calculate_confidence,
    validate_dob,
    validate_expiration_date,
    validate_national_id_detailed,
    validate_passport_number,
)

logger = logging.getLogger(__name__)

# Configuration
PORT = int(os.getenv("PORT", "5004"))
INTERNAL_SERVICE_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "").strip()
VERSION = "1.0.0"


def _get_git_sha() -> str:
    """Get git SHA from environment or git command."""
    if sha := os.getenv("GIT_SHA"):
        return sha
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    return "unknown"


def _get_build_time() -> str:
    """Get build time from environment or current time."""
    if build_time := os.getenv("BUILD_TIME"):
        return build_time
    return datetime.now(UTC).isoformat()


# Build info (resolved at module import)
GIT_SHA = _get_git_sha()
BUILD_TIME = _get_build_time()

# Track service start time
_start_time = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle for the OCR service."""
    logger.info("Warming up RapidOCR engine...")
    warmup_engine()
    logger.info("RapidOCR engine ready")
    yield


# =============================================================================
# Shared Document Extraction Logic
# =============================================================================


@dataclass
class DocumentExtractionResult:
    """Result from document extraction and validation."""

    extracted: ExtractedData | None
    doc_type: DocumentType
    validation_issues: list[str]
    validation_details: list["ValidationDetail"]
    confidence: float
    document_origin: str | None
    ocr_error: str | None = None


def _validate_national_id(
    extracted: ExtractedData,
    validation_issues: list[str],
    validation_details: list["ValidationDetail"],
) -> None:
    """Validate national ID document number using country-aware validation."""
    if extracted.document_number and extracted.nationality_code:
        result = validate_national_id_detailed(
            extracted.document_number, extracted.nationality_code
        )
        if result.error_code:
            validation_issues.append(result.error_code)
            if result.error_message:
                validation_details.append(
                    ValidationDetail(
                        errorCode=result.error_code,
                        errorMessage=result.error_message,
                        validatorUsed=result.validator_used,
                        formatName=result.format_name,
                    )
                )


def _validate_passport(
    extracted: ExtractedData,
    mrz_valid: bool,
    validation_issues: list[str],
) -> None:
    """Validate passport document."""
    if not mrz_valid:
        validation_issues.append("mrz_checksum_invalid")
    if extracted.document_number:
        validation_issues.extend(validate_passport_number(extracted.document_number))


def _validate_dates(extracted: ExtractedData, validation_issues: list[str]) -> None:
    """Validate expiration date and date of birth."""
    if extracted.expiration_date:
        validation_issues.extend(validate_expiration_date(extracted.expiration_date))
    if extracted.date_of_birth:
        validation_issues.extend(validate_dob(extracted.date_of_birth))


def _calculate_fields_count(extracted: ExtractedData | None) -> int:
    """Count how many key fields were extracted."""
    if not extracted:
        return 0
    return sum(
        1
        for f in [
            extracted.full_name,
            extracted.document_number,
            extracted.date_of_birth,
            extracted.expiration_date,
        ]
        if f
    )


def _extract_and_validate_document(image_base64: str) -> DocumentExtractionResult:
    """
    Extract document data from image and validate fields.

    This is the shared logic between /ocr and /process endpoints.
    Performs OCR, document type detection, field extraction, and validation.
    """
    validation_issues: list[str] = []
    validation_details: list[ValidationDetail] = []

    # Step 1: Extract text (MRZ-fast-path for passports)
    ocr_result = extract_document_text_from_base64(image_base64)

    if ocr_result.get("error"):
        return DocumentExtractionResult(
            extracted=None,
            doc_type=DocumentType.UNKNOWN,
            validation_issues=["ocr_failed", ocr_result["error"]],
            validation_details=[],
            confidence=0.0,
            document_origin=None,
            ocr_error=ocr_result["error"],
        )

    full_text = ocr_result.get("full_text", "")
    text_blocks = ocr_result.get("text_blocks", [])

    if not full_text or len(full_text) < 10:
        return DocumentExtractionResult(
            extracted=None,
            doc_type=DocumentType.UNKNOWN,
            validation_issues=["no_text_detected"],
            validation_details=[],
            confidence=0.0,
            document_origin=None,
        )

    # Step 2: Detect document type
    doc_type, _type_confidence = detect_document_type(full_text)

    # Step 3: Extract fields based on document type
    extracted: ExtractedData | None = None

    if doc_type == DocumentType.NATIONAL_ID:
        extracted = extract_national_id_fields(full_text)
        _validate_national_id(extracted, validation_issues, validation_details)
    elif doc_type == DocumentType.PASSPORT:
        extracted, mrz_valid = extract_passport_fields(full_text)
        _validate_passport(extracted, mrz_valid, validation_issues)
    elif doc_type == DocumentType.DRIVERS_LICENSE:
        extracted = extract_drivers_license_fields(full_text)

    # Step 4: Validate dates
    if extracted:
        _validate_dates(extracted, validation_issues)

    # Step 5: Calculate confidence
    fields_count = _calculate_fields_count(extracted)
    avg_ocr_confidence = (
        sum(b.get("confidence", 0) for b in text_blocks) / len(text_blocks) if text_blocks else 0.0
    )
    confidence = calculate_confidence(len(full_text), fields_count, avg_ocr_confidence)

    # Determine document origin
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


def _build_extracted_data_response(extracted: ExtractedData) -> "ExtractedDataResponse":
    """Build API response from extracted data."""
    return ExtractedDataResponse(
        fullName=extracted.full_name,
        firstName=extracted.first_name,
        lastName=extracted.last_name,
        documentNumber=extracted.document_number,
        dateOfBirth=extracted.date_of_birth,
        expirationDate=extracted.expiration_date,
        nationality=extracted.nationality,
        nationalityCode=extracted.nationality_code,
        issuingCountry=extracted.issuing_country,
        issuingCountryCode=extracted.issuing_country_code,
        gender=extracted.gender,
    )


# Initialize FastAPI
app = FastAPI(
    title="OCR Service",
    description="Document OCR and field extraction for identity documents",
    version="1.0.0",
    lifespan=lifespan,
)


# Privacy: Avoid echoing request bodies (e.g., base64 images) back in 422 responses.
# FastAPI's default RequestValidationError response may include the invalid input.
@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_request, _exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": "Invalid request"},
    )


# Optional internal auth (defense-in-depth).
# If INTERNAL_SERVICE_TOKEN is set, require it for all non-health endpoints.
@app.middleware("http")
async def internal_auth_middleware(request: Request, call_next):
    if INTERNAL_SERVICE_TOKEN:
        # Allow provider health checks, build info, and docs without auth.
        public_paths = ("/health", "/build-info", "/openapi.json")
        if request.url.path not in public_paths and not request.url.path.startswith("/docs"):
            provided = request.headers.get("x-zentity-internal-token")
            if provided != INTERNAL_SERVICE_TOKEN:
                return JSONResponse(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    content={"error": "Unauthorized"},
                )
    return await call_next(request)


# Request/Response models
class ImageRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded image")


class ExtractedDataResponse(BaseModel):
    fullName: str | None = None
    firstName: str | None = None  # Nombres
    lastName: str | None = None  # Apellidos
    documentNumber: str | None = None
    dateOfBirth: str | None = None
    expirationDate: str | None = None
    nationality: str | None = None  # Full country name
    nationalityCode: str | None = None  # ISO 3166-1 alpha-3 code
    issuingCountry: str | None = None  # Full country name of issuing state
    issuingCountryCode: str | None = None  # ISO 3166-1 alpha-3 issuing state code
    gender: str | None = None


class ValidationDetail(BaseModel):
    """Rich validation error details for frontend display."""

    errorCode: str = Field(..., description="Machine-readable error code")
    errorMessage: str = Field(..., description="User-friendly error message")
    validatorUsed: str | None = Field(
        None, description="Validator module used (e.g., 'stdnum.do.cedula')"
    )
    formatName: str | None = Field(
        None,
        description="Document format name (e.g., 'cedula (DR national ID)')",
    )


class DocumentResponse(BaseModel):
    documentType: str = Field(..., description="passport, national_id, drivers_license, unknown")
    documentOrigin: str | None = Field(
        None, description="Detected country of origin (e.g., 'DOM', 'USA')"
    )
    confidence: float = Field(..., ge=0, le=1)
    extractedData: ExtractedDataResponse | None = None
    validationIssues: list[str]
    validationDetails: list[ValidationDetail] | None = Field(
        None, description="Rich validation error details for frontend display"
    )
    processingTimeMs: int


class ExtractResponse(BaseModel):
    textBlocks: list[dict]
    fullText: str
    processingTimeMs: int
    error: str | None = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    uptimeSeconds: float


class BuildInfoResponse(BaseModel):
    """Build information for deployment verification."""

    service: str
    version: str
    gitSha: str
    buildTime: str


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Service health check endpoint."""
    return HealthResponse(
        status="healthy",
        service="ocr-service",
        version=VERSION,
        uptimeSeconds=round(time.time() - _start_time, 2),
    )


@app.get("/build-info", response_model=BuildInfoResponse)
async def build_info():
    """
    Build info endpoint for deployment verification.

    Allows users to verify the deployed code matches the source.
    Compare gitSha with GitHub releases and Sigstore attestations.
    """
    return BuildInfoResponse(
        service="ocr-service",
        version=VERSION,
        gitSha=GIT_SHA,
        buildTime=BUILD_TIME,
    )


@app.post("/extract", response_model=ExtractResponse)
async def extract_text_endpoint(request: ImageRequest):
    """
    Extract raw OCR text from image.

    Returns text blocks with bounding boxes and confidence scores.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    result = extract_text_from_base64(request.image)

    return ExtractResponse(
        textBlocks=result.get("text_blocks", []),
        fullText=result.get("full_text", ""),
        processingTimeMs=result.get("processing_time_ms", 0),
        error=result.get("error"),
    )


@app.post("/ocr", response_model=DocumentResponse)
async def ocr_document_endpoint(request: ImageRequest):
    """
    Full document OCR with field extraction.

    Performs:
    1. OCR text extraction
    2. Document type detection
    3. Field parsing based on document type
    4. Confidence calculation
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    start_time = time.time()
    result = _extract_and_validate_document(request.image)
    processing_time_ms = int((time.time() - start_time) * 1000)

    extracted_response = None
    if result.extracted:
        extracted_response = _build_extracted_data_response(result.extracted)

    return DocumentResponse(
        documentType=result.doc_type.value,
        documentOrigin=result.document_origin,
        confidence=round(result.confidence, 3),
        extractedData=extracted_response,
        validationIssues=result.validation_issues,
        validationDetails=result.validation_details if result.validation_details else None,
        processingTimeMs=processing_time_ms,
    )


# ============================================================================
# Privacy-Preserving Processing Endpoint
# ============================================================================


class ProcessDocumentRequest(BaseModel):
    """Request for full privacy-preserving document processing."""

    image: str = Field(..., description="Base64 encoded document image")
    userSalt: str | None = Field(
        None,
        description="Existing user salt. If not provided, a new one is generated.",
    )


class IdentityCommitmentsResponse(BaseModel):
    """Cryptographic commitments derived from document (safe to store)."""

    documentHash: str = Field(..., description="SHA256(doc_number + salt)")
    nameCommitment: str = Field(..., description="SHA256(name + salt)")
    issuingCountryCommitment: str | None = Field(
        None, description="SHA256(issuing_country_code + salt) - for fraud detection"
    )
    userSalt: str = Field(..., description="User's unique salt (store securely)")


class ProcessDocumentResponse(BaseModel):
    """
    Privacy-preserving document processing response.

    This response contains:
    - Commitments: Cryptographic hashes safe for permanent storage
    - Verification flags: Boolean results from validation
    - Extracted data: Returned for UI display only, MUST be discarded after use

    The caller is responsible for:
    1. Displaying extracted data to user for confirmation
    2. Storing ONLY the commitments and flags
    3. DISCARDING all extracted data after processing
    """

    # Cryptographic commitments (STORE THESE)
    commitments: IdentityCommitmentsResponse | None = None

    # Verification results (STORE THESE)
    documentType: str
    documentOrigin: str | None = None
    confidence: float

    # Transient data (DISPLAY THEN DISCARD)
    extractedData: ExtractedDataResponse | None = None

    # Metadata
    validationIssues: list[str]
    validationDetails: list[ValidationDetail] | None = Field(
        None, description="Rich validation error details for frontend display"
    )
    processingTimeMs: int


@app.post("/process", response_model=ProcessDocumentResponse)
async def process_document_endpoint(request: ProcessDocumentRequest):
    """
    Privacy-preserving document processing.

    This endpoint:
    1. Extracts text via OCR (transient)
    2. Parses identity fields (transient)
    3. Generates cryptographic commitments (permanent)
    4. Returns both for caller to handle appropriately

    The caller MUST:
    - Store only: commitments, verification flags
    - Discard: extractedData, original image

    This follows zkKYC principles where PII is processed transiently
    and only cryptographic proofs are persisted.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    start_time = time.time()
    result = _extract_and_validate_document(request.image)

    # Extend validation issues for commitment generation requirements
    validation_issues = list(result.validation_issues)

    # Generate cryptographic commitments
    commitments_response = None
    if result.extracted and result.extracted.document_number and result.extracted.full_name:
        user_salt = request.userSalt or generate_user_salt()
        identity_commitments = generate_identity_commitments(
            document_number=result.extracted.document_number,
            full_name=result.extracted.full_name,
            user_salt=user_salt,
            document_type=result.doc_type.value,
            issuing_country_code=result.extracted.issuing_country_code,
        )
        commitments_response = IdentityCommitmentsResponse(
            documentHash=identity_commitments.document_hash,
            nameCommitment=identity_commitments.name_commitment,
            issuingCountryCommitment=identity_commitments.issuing_country_commitment,
            userSalt=identity_commitments.user_salt,
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

    extracted_response = None
    if result.extracted:
        extracted_response = _build_extracted_data_response(result.extracted)

    return ProcessDocumentResponse(
        commitments=commitments_response,
        documentType=result.doc_type.value,
        documentOrigin=result.document_origin,
        confidence=round(result.confidence, 3),
        extractedData=extracted_response,
        validationIssues=validation_issues,
        validationDetails=result.validation_details if result.validation_details else None,
        processingTimeMs=processing_time_ms,
    )


# ============================================================================
# Name Verification Endpoint (for Relying Parties)
# ============================================================================


class VerifyNameRequest(BaseModel):
    """Request to verify if a claimed name matches the stored commitment."""

    claimedName: str = Field(..., description="The name being claimed")
    storedCommitment: str = Field(..., description="The stored name commitment hash")
    userSalt: str = Field(..., description="User's unique salt")


class VerifyNameResponse(BaseModel):
    """Response indicating if the claimed name matches."""

    matches: bool = Field(..., description="True if name matches commitment")


@app.post("/verify-name", response_model=VerifyNameResponse)
async def verify_name_endpoint(request: VerifyNameRequest):
    """
    Verify if a claimed name matches a stored commitment.

    This allows relying parties to verify names without us ever
    revealing or storing the actual name.

    Example flow:
    1. Relying party asks: "Is this user named Juan Perez?"
    2. We compute: hash = SHA256(normalize("Juan Perez") + salt)
    3. We compare: hash == stored_commitment
    4. We return: { matches: true/false }

    No PII is revealed in this process.
    """
    matches = verify_name_claim(
        claimed_name=request.claimedName,
        stored_commitment=request.storedCommitment,
        user_salt=request.userSalt,
    )
    return VerifyNameResponse(matches=matches)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
