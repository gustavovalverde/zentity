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

import os
import time
from typing import Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .ocr import extract_text_from_base64
from .parser import (
    ExtractedData,
    extract_national_id_fields,
    extract_passport_fields,
    extract_drivers_license_fields,
)
from .document_detector import (
    DocumentType,
    detect_document_type,
)
from .validators import (
    validate_national_id,
    validate_national_id_detailed,
    validate_passport_number,
    validate_expiration_date,
    validate_dob,
    calculate_confidence,
)
from .commitments import (
    generate_user_salt,
    generate_identity_commitments,
    verify_name_claim,
    verify_document_claim,
)

# Configuration
PORT = int(os.getenv("PORT", "5004"))

# Track service start time
_start_time = time.time()


# Initialize FastAPI
# Note: Model warmup is handled by entrypoint.sh before uvicorn starts
app = FastAPI(
    title="OCR Service",
    description="Document OCR and field extraction for identity documents",
    version="1.0.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response models
class ImageRequest(BaseModel):
    image: str = Field(..., description="Base64 encoded image")


class ExtractedDataResponse(BaseModel):
    fullName: Optional[str] = None
    firstName: Optional[str] = None   # Nombres
    lastName: Optional[str] = None    # Apellidos
    documentNumber: Optional[str] = None
    dateOfBirth: Optional[str] = None
    expirationDate: Optional[str] = None
    nationality: Optional[str] = None       # Full country name
    nationalityCode: Optional[str] = None   # ISO 3166-1 alpha-3 code
    issuingCountry: Optional[str] = None    # Full country name of issuing state
    issuingCountryCode: Optional[str] = None  # ISO 3166-1 alpha-3 issuing state code
    gender: Optional[str] = None


class ValidationDetail(BaseModel):
    """Rich validation error details for frontend display."""
    errorCode: str = Field(..., description="Machine-readable error code")
    errorMessage: str = Field(..., description="User-friendly error message")
    validatorUsed: Optional[str] = Field(
        None, description="Validator module used (e.g., 'stdnum.do.cedula')"
    )
    formatName: Optional[str] = Field(
        None, description="Document format name (e.g., 'cedula (Dominican Republic national ID)')"
    )


class DocumentResponse(BaseModel):
    documentType: str = Field(
        ..., description="passport, national_id, drivers_license, unknown"
    )
    documentOrigin: Optional[str] = Field(
        None, description="Detected country of origin (e.g., 'DOM', 'USA')"
    )
    confidence: float = Field(..., ge=0, le=1)
    extractedData: Optional[ExtractedDataResponse] = None
    validationIssues: List[str]
    validationDetails: Optional[List[ValidationDetail]] = Field(
        None, description="Rich validation error details for frontend display"
    )
    processingTimeMs: int


class ExtractResponse(BaseModel):
    textBlocks: List[dict]
    fullText: str
    processingTimeMs: int
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    uptimeSeconds: float


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Service health check endpoint.

    Models are warmed up via entrypoint.sh before uvicorn starts.
    """
    return HealthResponse(
        status="healthy",
        service="ocr-service",
        version="1.0.0",
        uptimeSeconds=round(time.time() - _start_time, 2),
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
    validation_issues: List[str] = []
    validation_details: List[ValidationDetail] = []

    # Step 1: Extract text
    ocr_result = extract_text_from_base64(request.image)

    if ocr_result.get("error"):
        return DocumentResponse(
            documentType="unknown",
            documentOrigin=None,
            confidence=0.0,
            extractedData=None,
            validationIssues=["ocr_failed", ocr_result["error"]],
            validationDetails=None,
            processingTimeMs=int((time.time() - start_time) * 1000),
        )

    full_text = ocr_result.get("full_text", "")
    text_blocks = ocr_result.get("text_blocks", [])

    if not full_text or len(full_text) < 10:
        return DocumentResponse(
            documentType="unknown",
            documentOrigin=None,
            confidence=0.0,
            extractedData=None,
            validationIssues=["no_text_detected"],
            validationDetails=None,
            processingTimeMs=int((time.time() - start_time) * 1000),
        )

    # Step 2: Detect document type
    doc_type, type_confidence = detect_document_type(full_text)

    # Step 3: Extract fields based on document type
    extracted: Optional[ExtractedData] = None

    if doc_type == DocumentType.NATIONAL_ID:
        extracted = extract_national_id_fields(full_text)
        # Validate document number format using country-aware validation
        if extracted.document_number and extracted.nationality_code:
            # Get detailed validation result for rich error messages
            result = validate_national_id_detailed(
                extracted.document_number, extracted.nationality_code
            )
            if result.error_code:
                validation_issues.append(result.error_code)
                if result.error_message:
                    validation_details.append(ValidationDetail(
                        errorCode=result.error_code,
                        errorMessage=result.error_message,
                        validatorUsed=result.validator_used,
                        formatName=result.format_name,
                    ))
    elif doc_type == DocumentType.PASSPORT:
        extracted, mrz_valid = extract_passport_fields(full_text)
        if not mrz_valid:
            validation_issues.append("mrz_checksum_invalid")
        if extracted.document_number:
            validation_issues.extend(validate_passport_number(extracted.document_number))
    elif doc_type == DocumentType.DRIVERS_LICENSE:
        extracted = extract_drivers_license_fields(full_text)

    # Step 5: Validate dates
    if extracted:
        if extracted.expiration_date:
            validation_issues.extend(validate_expiration_date(extracted.expiration_date))
        if extracted.date_of_birth:
            validation_issues.extend(validate_dob(extracted.date_of_birth))

    # Step 6: Calculate confidence
    fields_count = sum(
        1
        for f in [
            extracted.full_name if extracted else None,
            extracted.document_number if extracted else None,
            extracted.date_of_birth if extracted else None,
            extracted.expiration_date if extracted else None,
        ]
        if f
    )

    avg_ocr_confidence = (
        sum(b.get("confidence", 0) for b in text_blocks) / len(text_blocks)
        if text_blocks
        else 0.0
    )

    confidence = calculate_confidence(
        len(full_text),
        fields_count,
        avg_ocr_confidence,
    )

    # Build response
    extracted_response = None
    document_origin = None
    if extracted:
        extracted_response = ExtractedDataResponse(
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
        # Use issuing country as document origin if available, otherwise fall back to nationality
        document_origin = extracted.issuing_country_code or extracted.nationality_code

    processing_time_ms = int((time.time() - start_time) * 1000)

    return DocumentResponse(
        documentType=doc_type.value,
        documentOrigin=document_origin,
        confidence=round(confidence, 3),
        extractedData=extracted_response,
        validationIssues=validation_issues,
        validationDetails=validation_details if validation_details else None,
        processingTimeMs=processing_time_ms,
    )


# ============================================================================
# Privacy-Preserving Processing Endpoint
# ============================================================================


class ProcessDocumentRequest(BaseModel):
    """Request for full privacy-preserving document processing."""

    image: str = Field(..., description="Base64 encoded document image")
    userSalt: Optional[str] = Field(
        None,
        description="Existing user salt. If not provided, a new salt will be generated.",
    )


class IdentityCommitmentsResponse(BaseModel):
    """Cryptographic commitments derived from document (safe to store)."""

    documentHash: str = Field(..., description="SHA256(doc_number + salt)")
    nameCommitment: str = Field(..., description="SHA256(name + salt)")
    issuingCountryCommitment: Optional[str] = Field(
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
    commitments: Optional[IdentityCommitmentsResponse] = None

    # Verification results (STORE THESE)
    documentType: str
    documentOrigin: Optional[str] = None
    confidence: float

    # Transient data (DISPLAY THEN DISCARD)
    extractedData: Optional[ExtractedDataResponse] = None

    # Metadata
    validationIssues: List[str]
    validationDetails: Optional[List[ValidationDetail]] = Field(
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
    validation_issues: List[str] = []
    validation_details: List[ValidationDetail] = []

    # Step 1: Extract text (transient)
    ocr_result = extract_text_from_base64(request.image)

    if ocr_result.get("error"):
        return ProcessDocumentResponse(
            commitments=None,
            documentType="unknown",
            documentOrigin=None,
            confidence=0.0,
            extractedData=None,
            validationIssues=["ocr_failed", ocr_result["error"]],
            validationDetails=None,
            processingTimeMs=int((time.time() - start_time) * 1000),
        )

    full_text = ocr_result.get("full_text", "")
    text_blocks = ocr_result.get("text_blocks", [])

    if not full_text or len(full_text) < 10:
        return ProcessDocumentResponse(
            commitments=None,
            documentType="unknown",
            documentOrigin=None,
            confidence=0.0,
            extractedData=None,
            validationIssues=["no_text_detected"],
            validationDetails=None,
            processingTimeMs=int((time.time() - start_time) * 1000),
        )

    # Step 2: Detect document type
    doc_type, type_confidence = detect_document_type(full_text)

    # Step 3: Extract fields based on document type (transient)
    extracted: Optional[ExtractedData] = None

    if doc_type == DocumentType.NATIONAL_ID:
        extracted = extract_national_id_fields(full_text)
        # Validate document number format using country-aware validation
        if extracted.document_number and extracted.nationality_code:
            # Get detailed validation result for rich error messages
            result = validate_national_id_detailed(
                extracted.document_number, extracted.nationality_code
            )
            if result.error_code:
                validation_issues.append(result.error_code)
                if result.error_message:
                    validation_details.append(ValidationDetail(
                        errorCode=result.error_code,
                        errorMessage=result.error_message,
                        validatorUsed=result.validator_used,
                        formatName=result.format_name,
                    ))
    elif doc_type == DocumentType.PASSPORT:
        extracted, mrz_valid = extract_passport_fields(full_text)
        if not mrz_valid:
            validation_issues.append("mrz_checksum_invalid")
        if extracted.document_number:
            validation_issues.extend(validate_passport_number(extracted.document_number))
    elif doc_type == DocumentType.DRIVERS_LICENSE:
        extracted = extract_drivers_license_fields(full_text)

    # Step 5: Validate dates
    if extracted:
        if extracted.expiration_date:
            validation_issues.extend(validate_expiration_date(extracted.expiration_date))
        if extracted.date_of_birth:
            validation_issues.extend(validate_dob(extracted.date_of_birth))

    # Step 6: Generate cryptographic commitments
    commitments_response = None
    if extracted and extracted.document_number and extracted.full_name:
        user_salt = request.userSalt or generate_user_salt()
        identity_commitments = generate_identity_commitments(
            document_number=extracted.document_number,
            full_name=extracted.full_name,
            user_salt=user_salt,
            document_type=doc_type.value,
            issuing_country_code=extracted.issuing_country_code,
        )
        commitments_response = IdentityCommitmentsResponse(
            documentHash=identity_commitments.document_hash,
            nameCommitment=identity_commitments.name_commitment,
            issuingCountryCommitment=identity_commitments.issuing_country_commitment,
            userSalt=identity_commitments.user_salt,
        )
    else:
        if not extracted:
            validation_issues.append("extraction_failed")
        else:
            if not extracted.document_number:
                validation_issues.append("missing_document_number")
            if not extracted.full_name:
                validation_issues.append("missing_full_name")

    # Step 7: Calculate confidence
    fields_count = sum(
        1
        for f in [
            extracted.full_name if extracted else None,
            extracted.document_number if extracted else None,
            extracted.date_of_birth if extracted else None,
            extracted.expiration_date if extracted else None,
        ]
        if f
    )

    avg_ocr_confidence = (
        sum(b.get("confidence", 0) for b in text_blocks) / len(text_blocks)
        if text_blocks
        else 0.0
    )

    confidence = calculate_confidence(
        len(full_text),
        fields_count,
        avg_ocr_confidence,
    )

    # Build response with transient extracted data
    extracted_response = None
    document_origin = None
    if extracted:
        extracted_response = ExtractedDataResponse(
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
        # Use issuing country as document origin if available, otherwise fall back to nationality
        document_origin = extracted.issuing_country_code or extracted.nationality_code

    processing_time_ms = int((time.time() - start_time) * 1000)

    return ProcessDocumentResponse(
        commitments=commitments_response,
        documentType=doc_type.value,
        documentOrigin=document_origin,
        confidence=round(confidence, 3),
        extractedData=extracted_response,
        validationIssues=validation_issues,
        validationDetails=validation_details if validation_details else None,
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
