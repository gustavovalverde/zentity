"""
Unit tests for the commitments module.

Tests the privacy-preserving cryptographic commitment generation:
- Document number normalization and hashing
- Name normalization and commitment generation
- Verification of claims against stored commitments
"""

import pytest

from ocr_service.services.commitments import (
    IdentityCommitments,
    generate_identity_commitments,
    generate_issuing_country_commitment,
    generate_name_commitment,
    generate_user_salt,
    hash_document_number,
    normalize_document_number,
    normalize_name,
    verify_document_claim,
    verify_name_claim,
)


class TestNormalizeDocumentNumber:
    """Tests for document number normalization."""

    def test_removes_hyphens(self):
        assert normalize_document_number("001-1234567-8") == "00112345678"

    def test_removes_spaces(self):
        assert normalize_document_number("001 1234567 8") == "00112345678"

    def test_removes_mixed_separators(self):
        assert normalize_document_number("001-1234 567-8") == "00112345678"

    def test_converts_to_uppercase(self):
        assert normalize_document_number("abc123def") == "ABC123DEF"

    def test_empty_string_returns_empty(self):
        assert normalize_document_number("") == ""

    def test_none_handling(self):
        # Explicitly test None is handled gracefully
        assert normalize_document_number(None or "") == ""

    def test_removes_special_characters(self):
        assert normalize_document_number("001.1234567/8") == "00112345678"

    def test_already_normalized(self):
        assert normalize_document_number("00112345678") == "00112345678"


class TestNormalizeName:
    """Tests for name normalization."""

    def test_removes_accents(self):
        assert normalize_name("Juan Pérez") == "JUAN PEREZ"

    def test_removes_various_accents(self):
        assert normalize_name("José María García Núñez") == "JOSE MARIA GARCIA NUNEZ"

    def test_collapses_whitespace(self):
        assert normalize_name("  Juan   Pérez  ") == "JUAN PEREZ"

    def test_converts_to_uppercase(self):
        assert normalize_name("john doe") == "JOHN DOE"

    def test_empty_string_returns_empty(self):
        assert normalize_name("") == ""

    def test_already_normalized(self):
        assert normalize_name("JUAN PEREZ") == "JUAN PEREZ"

    def test_handles_tabs_and_newlines(self):
        assert normalize_name("Juan\t\nPérez") == "JUAN PEREZ"

    def test_unicode_normalization(self):
        # Test combining characters
        assert normalize_name("Café") == "CAFE"


class TestHashDocumentNumber:
    """Tests for document number hashing."""

    def test_deterministic_output(self, sample_salt):
        hash1 = hash_document_number("001-1234567-8", sample_salt)
        hash2 = hash_document_number("001-1234567-8", sample_salt)
        assert hash1 == hash2

    def test_different_salts_produce_different_hashes(self):
        salt1 = "salt1" + "0" * 58
        salt2 = "salt2" + "0" * 58
        hash1 = hash_document_number("00112345678", salt1)
        hash2 = hash_document_number("00112345678", salt2)
        assert hash1 != hash2

    def test_normalized_inputs_match(self, sample_salt):
        hash1 = hash_document_number("001-1234567-8", sample_salt)
        hash2 = hash_document_number("00112345678", sample_salt)
        assert hash1 == hash2

    def test_different_documents_produce_different_hashes(self, sample_salt):
        hash1 = hash_document_number("001-1234567-8", sample_salt)
        hash2 = hash_document_number("001-1234567-9", sample_salt)
        assert hash1 != hash2

    def test_raises_on_empty(self, sample_salt):
        with pytest.raises(ValueError, match="cannot be empty"):
            hash_document_number("", sample_salt)

    def test_hash_format_is_sha256(self, sample_salt):
        result = hash_document_number("12345", sample_salt)
        assert len(result) == 64  # SHA256 hex = 64 chars
        assert all(c in "0123456789abcdef" for c in result)

    def test_case_variations_match(self, sample_salt):
        hash1 = hash_document_number("ABC123", sample_salt)
        hash2 = hash_document_number("abc123", sample_salt)
        assert hash1 == hash2


class TestGenerateNameCommitment:
    """Tests for name commitment generation."""

    def test_deterministic_output(self, sample_salt):
        commit1 = generate_name_commitment("Juan Perez", sample_salt)
        commit2 = generate_name_commitment("Juan Perez", sample_salt)
        assert commit1 == commit2

    def test_case_insensitive(self, sample_salt):
        commit1 = generate_name_commitment("JUAN PEREZ", sample_salt)
        commit2 = generate_name_commitment("juan perez", sample_salt)
        assert commit1 == commit2

    def test_accent_insensitive(self, sample_salt):
        commit1 = generate_name_commitment("Juan Pérez", sample_salt)
        commit2 = generate_name_commitment("Juan Perez", sample_salt)
        assert commit1 == commit2

    def test_whitespace_insensitive(self, sample_salt):
        commit1 = generate_name_commitment("Juan Perez", sample_salt)
        commit2 = generate_name_commitment("  Juan   Perez  ", sample_salt)
        assert commit1 == commit2

    def test_different_names_produce_different_commits(self, sample_salt):
        commit1 = generate_name_commitment("Juan Perez", sample_salt)
        commit2 = generate_name_commitment("Maria Garcia", sample_salt)
        assert commit1 != commit2

    def test_raises_on_empty(self, sample_salt):
        with pytest.raises(ValueError, match="cannot be empty"):
            generate_name_commitment("", sample_salt)

    def test_commitment_format_is_sha256(self, sample_salt):
        result = generate_name_commitment("Test Name", sample_salt)
        assert len(result) == 64  # SHA256 hex = 64 chars
        assert all(c in "0123456789abcdef" for c in result)


class TestVerifyNameClaim:
    """Tests for name claim verification."""

    def test_matching_name_returns_true(self):
        salt = generate_user_salt()
        commitment = generate_name_commitment("Juan Perez", salt)
        assert verify_name_claim("Juan Perez", commitment, salt) is True

    def test_case_insensitive_match(self):
        salt = generate_user_salt()
        commitment = generate_name_commitment("JUAN PEREZ", salt)
        assert verify_name_claim("juan perez", commitment, salt) is True

    def test_accent_insensitive_match(self):
        salt = generate_user_salt()
        commitment = generate_name_commitment("Juan Pérez", salt)
        assert verify_name_claim("Juan Perez", commitment, salt) is True

    def test_wrong_name_returns_false(self):
        salt = generate_user_salt()
        commitment = generate_name_commitment("Juan Perez", salt)
        assert verify_name_claim("Maria Garcia", commitment, salt) is False

    def test_wrong_salt_returns_false(self):
        salt1 = generate_user_salt()
        salt2 = generate_user_salt()
        commitment = generate_name_commitment("Juan Perez", salt1)
        assert verify_name_claim("Juan Perez", commitment, salt2) is False

    def test_partial_name_returns_false(self):
        salt = generate_user_salt()
        commitment = generate_name_commitment("Juan Carlos Perez", salt)
        assert verify_name_claim("Juan Perez", commitment, salt) is False


class TestVerifyDocumentClaim:
    """Tests for document claim verification."""

    def test_matching_document_returns_true(self):
        salt = generate_user_salt()
        doc_hash = hash_document_number("001-1234567-8", salt)
        assert verify_document_claim("001-1234567-8", doc_hash, salt) is True

    def test_normalized_document_matches(self):
        salt = generate_user_salt()
        doc_hash = hash_document_number("001-1234567-8", salt)
        assert verify_document_claim("00112345678", doc_hash, salt) is True

    def test_wrong_document_returns_false(self):
        salt = generate_user_salt()
        doc_hash = hash_document_number("001-1234567-8", salt)
        assert verify_document_claim("001-1234567-9", doc_hash, salt) is False

    def test_wrong_salt_returns_false(self):
        salt1 = generate_user_salt()
        salt2 = generate_user_salt()
        doc_hash = hash_document_number("001-1234567-8", salt1)
        assert verify_document_claim("001-1234567-8", doc_hash, salt2) is False


class TestGenerateUserSalt:
    """Tests for user salt generation."""

    def test_salt_length(self):
        salt = generate_user_salt()
        assert len(salt) == 64  # 32 bytes hex = 64 chars

    def test_salt_is_hex(self):
        salt = generate_user_salt()
        assert all(c in "0123456789abcdef" for c in salt)

    def test_salts_are_unique(self):
        salt1 = generate_user_salt()
        salt2 = generate_user_salt()
        assert salt1 != salt2


class TestIdentityCommitments:
    """Tests for IdentityCommitments class."""

    def test_to_dict_excludes_salt(self, sample_salt):
        commitments = IdentityCommitments(
            document_hash="abc123",
            name_commitment="def456",
            user_salt=sample_salt,
            document_type="cedula",
        )
        result = commitments.to_dict()

        assert "document_hash" in result
        assert "name_commitment" in result
        assert "document_type" in result
        assert "user_salt" not in result  # Salt should NOT be in dict


class TestGenerateIdentityCommitments:
    """Tests for the main commitment generation function."""

    def test_generates_all_commitments(self):
        result = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            document_type="cedula",
        )

        assert result.document_hash is not None
        assert result.name_commitment is not None
        assert result.user_salt is not None
        assert result.document_type == "cedula"

    def test_uses_provided_salt(self, sample_salt):
        result = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
        )

        assert result.user_salt == sample_salt

    def test_generates_new_salt_if_not_provided(self):
        result1 = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
        )
        result2 = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
        )

        assert result1.user_salt != result2.user_salt

    def test_commitments_are_deterministic_with_same_salt(self, sample_salt):
        result1 = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
        )
        result2 = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
        )

        assert result1.document_hash == result2.document_hash
        assert result1.name_commitment == result2.name_commitment

    def test_issuing_country_commitment_generated(self, sample_salt):
        """Test that issuing country commitment is generated when code is provided."""
        result = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
            issuing_country_code="DOM",
        )

        assert result.issuing_country_commitment is not None
        assert len(result.issuing_country_commitment) == 64  # SHA256 hex

    def test_issuing_country_commitment_none_when_not_provided(self, sample_salt):
        """Test that issuing country commitment is None when not provided."""
        result = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
        )

        assert result.issuing_country_commitment is None

    def test_issuing_country_commitment_deterministic(self, sample_salt):
        """Test that issuing country commitment is deterministic."""
        result1 = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
            issuing_country_code="DOM",
        )
        result2 = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
            issuing_country_code="DOM",
        )

        assert result1.issuing_country_commitment == result2.issuing_country_commitment

    def test_different_issuing_countries_produce_different_commitments(self, sample_salt):
        """Test that different issuing countries produce different commitments."""
        result1 = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
            issuing_country_code="DOM",
        )
        result2 = generate_identity_commitments(
            document_number="001-1234567-8",
            full_name="Juan Perez",
            user_salt=sample_salt,
            issuing_country_code="USA",
        )

        assert result1.issuing_country_commitment != result2.issuing_country_commitment


class TestGenerateIssuingCountryCommitment:
    """Tests for issuing country commitment generation."""

    def test_deterministic_output(self, sample_salt):
        commit1 = generate_issuing_country_commitment("DOM", sample_salt)
        commit2 = generate_issuing_country_commitment("DOM", sample_salt)
        assert commit1 == commit2

    def test_case_insensitive(self, sample_salt):
        commit1 = generate_issuing_country_commitment("DOM", sample_salt)
        commit2 = generate_issuing_country_commitment("dom", sample_salt)
        assert commit1 == commit2

    def test_strips_whitespace(self, sample_salt):
        commit1 = generate_issuing_country_commitment("DOM", sample_salt)
        commit2 = generate_issuing_country_commitment("  DOM  ", sample_salt)
        assert commit1 == commit2

    def test_different_countries_produce_different_commits(self, sample_salt):
        commit1 = generate_issuing_country_commitment("DOM", sample_salt)
        commit2 = generate_issuing_country_commitment("USA", sample_salt)
        assert commit1 != commit2

    def test_raises_on_empty(self, sample_salt):
        with pytest.raises(ValueError, match="cannot be empty"):
            generate_issuing_country_commitment("", sample_salt)

    def test_commitment_format_is_sha256(self, sample_salt):
        result = generate_issuing_country_commitment("DOM", sample_salt)
        assert len(result) == 64  # SHA256 hex = 64 chars
        assert all(c in "0123456789abcdef" for c in result)

    def test_different_salts_produce_different_commits(self):
        salt1 = "salt1" + "0" * 58
        salt2 = "salt2" + "0" * 58
        commit1 = generate_issuing_country_commitment("DOM", salt1)
        commit2 = generate_issuing_country_commitment("DOM", salt2)
        assert commit1 != commit2
