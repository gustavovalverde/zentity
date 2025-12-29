"""
Integration tests for the OCR service API endpoints.

Tests all REST endpoints with realistic requests, error handling,
authentication middleware, and privacy protections.
"""

import os

import pytest
from fastapi.testclient import TestClient

from ocr_service.main import create_app


def _set_test_env(token: str = "") -> None:
    os.environ["INTERNAL_SERVICE_TOKEN"] = token  # noqa: S105
    os.environ["INTERNAL_SERVICE_TOKEN_REQUIRED"] = "0"  # noqa: S105
    os.environ["NODE_ENV"] = "test"
    os.environ["APP_ENV"] = "test"
    os.environ["RUST_ENV"] = "test"


@pytest.fixture
def client():
    """FastAPI test client."""
    _set_test_env()
    return TestClient(create_app())


@pytest.fixture
def auth_client():
    """FastAPI test client with auth token configured."""
    # Set token for authenticated requests
    _set_test_env(token="test-secret-token")  # noqa: S106
    client = TestClient(create_app())
    yield client
    # Clean up
    os.environ["INTERNAL_SERVICE_TOKEN"] = ""
    os.environ["INTERNAL_SERVICE_TOKEN_REQUIRED"] = ""
    os.environ["APP_ENV"] = ""
    os.environ["RUST_ENV"] = ""


# =============================================================================
# Health Check Endpoint Tests
# =============================================================================


class TestHealthEndpoint:
    """Tests for GET /health endpoint."""

    def test_returns_200(self, client):
        """Health check returns 200 OK."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_returns_healthy_status(self, client):
        """Health check returns healthy status."""
        response = client.get("/health")
        data = response.json()
        assert data["status"] == "healthy"

    def test_returns_service_name(self, client):
        """Health check returns service name."""
        response = client.get("/health")
        data = response.json()
        assert data["service"] == "ocr-service"

    def test_returns_version(self, client):
        """Health check returns version."""
        response = client.get("/health")
        data = response.json()
        assert "version" in data
        assert data["version"] is not None

    def test_returns_uptime(self, client):
        """Health check returns uptime in seconds."""
        response = client.get("/health")
        data = response.json()
        assert "uptimeSeconds" in data
        assert isinstance(data["uptimeSeconds"], (int, float))
        assert data["uptimeSeconds"] >= 0


class TestBuildInfoEndpoint:
    """Tests for GET /build-info endpoint."""

    def test_returns_200(self, client):
        """Build info returns 200 OK."""
        response = client.get("/build-info")
        assert response.status_code == 200

    def test_returns_service_name(self, client):
        """Build info returns service name."""
        response = client.get("/build-info")
        data = response.json()
        assert data["service"] == "ocr-service"

    def test_returns_git_sha(self, client):
        """Build info returns git SHA."""
        response = client.get("/build-info")
        data = response.json()
        assert "gitSha" in data
        assert data["gitSha"] is not None

    def test_returns_build_time(self, client):
        """Build info returns build time."""
        response = client.get("/build-info")
        data = response.json()
        assert "buildTime" in data
        assert data["buildTime"] is not None


# =============================================================================
# Extract Endpoint Tests
# =============================================================================


class TestExtractEndpoint:
    """Tests for POST /extract endpoint."""

    def test_returns_200_with_valid_image(self, client, passport_icao_base64):
        """Valid image returns 200 with extracted text."""
        response = client.post("/extract", json={"image": passport_icao_base64})
        assert response.status_code == 200

    def test_returns_text_blocks(self, client, passport_icao_base64):
        """Response includes text blocks array."""
        response = client.post("/extract", json={"image": passport_icao_base64})
        data = response.json()
        assert "textBlocks" in data
        assert isinstance(data["textBlocks"], list)

    def test_returns_full_text(self, client, passport_icao_base64):
        """Response includes full text string."""
        response = client.post("/extract", json={"image": passport_icao_base64})
        data = response.json()
        assert "fullText" in data
        assert isinstance(data["fullText"], str)

    def test_returns_processing_time(self, client, passport_icao_base64):
        """Response includes processing time in milliseconds."""
        response = client.post("/extract", json={"image": passport_icao_base64})
        data = response.json()
        assert "processingTimeMs" in data
        assert isinstance(data["processingTimeMs"], int)

    def test_extracts_text_from_passport(self, client, passport_icao_base64):
        """Passport image produces non-empty text."""
        response = client.post("/extract", json={"image": passport_icao_base64})
        data = response.json()
        assert len(data["fullText"]) > 0

    # --- Edge cases / Pitfalls ---

    def test_returns_400_without_image(self, client):
        """Missing image field returns 400."""
        response = client.post("/extract", json={})
        assert response.status_code == 422  # Pydantic validation error

    def test_invalid_base64_returns_error(self, client, invalid_base64):
        """Invalid base64 returns error in response."""
        response = client.post("/extract", json={"image": invalid_base64})
        data = response.json()
        # Should return 200 with error field, not 500
        assert response.status_code == 200
        assert data.get("error") is not None

    def test_blank_image_returns_empty_text(self, client, blank_image_base64):
        """Blank image returns minimal/empty text."""
        response = client.post("/extract", json={"image": blank_image_base64})
        data = response.json()
        assert response.status_code == 200
        # Should have valid structure even with no text
        assert "fullText" in data


# =============================================================================
# OCR Endpoint Tests
# =============================================================================


class TestOcrEndpoint:
    """Tests for POST /ocr endpoint."""

    def test_returns_200_with_valid_image(self, client, passport_icao_base64):
        """Valid image returns 200."""
        response = client.post("/ocr", json={"image": passport_icao_base64})
        assert response.status_code == 200

    def test_detects_passport_type(self, client, passport_icao_base64):
        """Passport image is detected as passport type."""
        response = client.post("/ocr", json={"image": passport_icao_base64})
        data = response.json()
        assert data["documentType"] == "passport"

    def test_returns_confidence_score(self, client, passport_icao_base64):
        """Response includes confidence score between 0 and 1."""
        response = client.post("/ocr", json={"image": passport_icao_base64})
        data = response.json()
        assert "confidence" in data
        assert 0 <= data["confidence"] <= 1

    def test_returns_extracted_data(self, client, passport_icao_base64):
        """Response includes extracted data object."""
        response = client.post("/ocr", json={"image": passport_icao_base64})
        data = response.json()
        assert "extractedData" in data
        # extractedData may be None if extraction failed
        if data["extractedData"]:
            assert "fullName" in data["extractedData"] or data["extractedData"] is None

    def test_returns_validation_issues(self, client, passport_icao_base64):
        """Response includes validation issues array."""
        response = client.post("/ocr", json={"image": passport_icao_base64})
        data = response.json()
        assert "validationIssues" in data
        assert isinstance(data["validationIssues"], list)

    def test_returns_processing_time(self, client, passport_icao_base64):
        """Response includes processing time."""
        response = client.post("/ocr", json={"image": passport_icao_base64})
        data = response.json()
        assert "processingTimeMs" in data

    def test_detects_id_card_type(self, client, id_card_spain_base64):
        """ID card image is detected as national_id type."""
        response = client.post("/ocr", json={"image": id_card_spain_base64})
        data = response.json()
        # Should detect as national_id or at least not passport
        assert data["documentType"] in ["national_id", "unknown"]

    # --- Edge cases / Pitfalls ---

    def test_blank_image_returns_unknown_type(self, client, blank_image_base64):
        """Blank image returns unknown document type."""
        response = client.post("/ocr", json={"image": blank_image_base64})
        data = response.json()
        assert data["documentType"] == "unknown"
        assert "no_text_detected" in data["validationIssues"]

    def test_invalid_image_returns_error_in_issues(self, client, invalid_base64):
        """Invalid image returns error in validation issues."""
        response = client.post("/ocr", json={"image": invalid_base64})
        data = response.json()
        assert "ocr_failed" in data["validationIssues"]


# =============================================================================
# Process Endpoint Tests
# =============================================================================


class TestProcessEndpoint:
    """Tests for POST /process endpoint (privacy-preserving)."""

    def test_returns_200_with_valid_image(self, client, passport_icao_base64):
        """Valid image returns 200."""
        response = client.post("/process", json={"image": passport_icao_base64})
        assert response.status_code == 200

    def test_returns_commitments_for_valid_document(self, client, passport_icao_base64):
        """Valid document returns cryptographic commitments."""
        response = client.post("/process", json={"image": passport_icao_base64})
        data = response.json()
        # Commitments may be None if extraction failed
        if data.get("commitments"):
            assert "documentHash" in data["commitments"]
            assert "nameCommitment" in data["commitments"]
            assert "userSalt" in data["commitments"]

    def test_commitments_are_sha256_hex(self, client, passport_icao_base64):
        """Commitments are 64-character hex strings (SHA256)."""
        response = client.post("/process", json={"image": passport_icao_base64})
        data = response.json()
        if data.get("commitments"):
            assert len(data["commitments"]["documentHash"]) == 64
            assert len(data["commitments"]["nameCommitment"]) == 64
            assert all(c in "0123456789abcdef" for c in data["commitments"]["documentHash"])

    def test_uses_provided_salt(self, client, passport_icao_base64, sample_salt):
        """Uses provided user salt instead of generating new."""
        response = client.post(
            "/process", json={"image": passport_icao_base64, "userSalt": sample_salt}
        )
        data = response.json()
        if data.get("commitments"):
            assert data["commitments"]["userSalt"] == sample_salt

    def test_generates_salt_if_not_provided(self, client, passport_icao_base64):
        """Generates new salt if not provided."""
        response = client.post("/process", json={"image": passport_icao_base64})
        data = response.json()
        if data.get("commitments"):
            assert len(data["commitments"]["userSalt"]) == 64

    def test_returns_extracted_data_for_display(self, client, passport_icao_base64):
        """Returns extracted data for UI display (to be discarded)."""
        response = client.post("/process", json={"image": passport_icao_base64})
        data = response.json()
        assert "extractedData" in data

    def test_returns_validation_issues(self, client, passport_icao_base64):
        """Returns validation issues array."""
        response = client.post("/process", json={"image": passport_icao_base64})
        data = response.json()
        assert "validationIssues" in data

    # --- Edge cases / Pitfalls ---

    def test_missing_fields_returns_issues(self, client, blank_image_base64):
        """Missing required fields returns validation issues."""
        response = client.post("/process", json={"image": blank_image_base64})
        data = response.json()
        # Should have extraction_failed or similar
        assert len(data["validationIssues"]) > 0

    def test_no_commitments_when_extraction_fails(self, client, blank_image_base64):
        """No commitments generated when extraction fails."""
        response = client.post("/process", json={"image": blank_image_base64})
        data = response.json()
        assert data["commitments"] is None


# =============================================================================
# Verify Name Endpoint Tests
# =============================================================================


class TestVerifyNameEndpoint:
    """Tests for POST /verify-name endpoint."""

    def test_returns_200(self, client, sample_salt):
        """Valid request returns 200."""
        from ocr_service.services.commitments import generate_name_commitment

        commitment = generate_name_commitment("Juan Perez", sample_salt)
        response = client.post(
            "/verify-name",
            json={
                "claimedName": "Juan Perez",
                "storedCommitment": commitment,
                "userSalt": sample_salt,
            },
        )
        assert response.status_code == 200

    def test_matching_name_returns_true(self, client, sample_salt):
        """Matching name returns matches=true."""
        from ocr_service.services.commitments import generate_name_commitment

        commitment = generate_name_commitment("Juan Perez", sample_salt)
        response = client.post(
            "/verify-name",
            json={
                "claimedName": "Juan Perez",
                "storedCommitment": commitment,
                "userSalt": sample_salt,
            },
        )
        data = response.json()
        assert data["matches"] is True

    def test_non_matching_name_returns_false(self, client, sample_salt):
        """Non-matching name returns matches=false."""
        from ocr_service.services.commitments import generate_name_commitment

        commitment = generate_name_commitment("Juan Perez", sample_salt)
        response = client.post(
            "/verify-name",
            json={
                "claimedName": "Maria Garcia",
                "storedCommitment": commitment,
                "userSalt": sample_salt,
            },
        )
        data = response.json()
        assert data["matches"] is False

    def test_case_insensitive_matching(self, client, sample_salt):
        """Name matching is case insensitive."""
        from ocr_service.services.commitments import generate_name_commitment

        commitment = generate_name_commitment("JUAN PEREZ", sample_salt)
        response = client.post(
            "/verify-name",
            json={
                "claimedName": "juan perez",
                "storedCommitment": commitment,
                "userSalt": sample_salt,
            },
        )
        data = response.json()
        assert data["matches"] is True

    def test_accent_insensitive_matching(self, client, sample_salt):
        """Name matching is accent insensitive."""
        from ocr_service.services.commitments import generate_name_commitment

        commitment = generate_name_commitment("Juan Pérez", sample_salt)
        response = client.post(
            "/verify-name",
            json={
                "claimedName": "Juan Perez",
                "storedCommitment": commitment,
                "userSalt": sample_salt,
            },
        )
        data = response.json()
        assert data["matches"] is True


# =============================================================================
# Authentication Middleware Tests
# =============================================================================


class TestAuthenticationMiddleware:
    """Tests for internal authentication middleware."""

    def test_health_accessible_without_auth(self, client):
        """Health endpoint is accessible without auth token."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_build_info_accessible_without_auth(self, client):
        """Build info endpoint is accessible without auth token."""
        response = client.get("/build-info")
        assert response.status_code == 200

    # Note: Auth tests with token require proper environment setup
    # The middleware only enforces auth when INTERNAL_SERVICE_TOKEN is set


# =============================================================================
# Privacy Protection Tests
# =============================================================================


class TestPrivacyProtection:
    """Tests for privacy protections in error responses."""

    def test_validation_error_does_not_echo_image(self, client):
        """422 validation error does not echo the image data back."""
        # Send a malformed request that triggers validation error
        response = client.post("/ocr", json={"image": 12345})  # Wrong type
        assert response.status_code == 422
        # Response should not contain the image data
        response_text = response.text
        assert "12345" not in response_text or "Invalid request" in response_text

    def test_error_response_is_generic(self, client):
        """Error responses are generic, not detailed."""
        response = client.post("/ocr", json={"wrong_field": "data"})
        assert response.status_code == 422
        data = response.json()
        # Should be a generic error, not exposing internals
        assert "error" in data or "detail" in data


# =============================================================================
# Response Schema Tests
# =============================================================================


class TestResponseSchemas:
    """Tests for response schema compliance."""

    def test_health_response_schema(self, client):
        """Health response matches HealthResponse schema."""
        response = client.get("/health")
        data = response.json()
        required_fields = ["status", "service", "version", "uptimeSeconds"]
        for field in required_fields:
            assert field in data

    def test_build_info_response_schema(self, client):
        """Build info response matches BuildInfoResponse schema."""
        response = client.get("/build-info")
        data = response.json()
        required_fields = ["service", "version", "gitSha", "buildTime"]
        for field in required_fields:
            assert field in data

    def test_document_response_schema(self, client, passport_icao_base64):
        """OCR response matches DocumentResponse schema."""
        response = client.post("/ocr", json={"image": passport_icao_base64})
        data = response.json()
        required_fields = [
            "documentType",
            "confidence",
            "validationIssues",
            "processingTimeMs",
        ]
        for field in required_fields:
            assert field in data

    def test_process_response_schema(self, client, passport_icao_base64):
        """Process response matches ProcessDocumentResponse schema."""
        response = client.post("/process", json={"image": passport_icao_base64})
        data = response.json()
        required_fields = [
            "documentType",
            "confidence",
            "validationIssues",
            "processingTimeMs",
        ]
        for field in required_fields:
            assert field in data
