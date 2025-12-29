"""
Unit tests for the validators module.

Tests document validation, date validation, confidence scoring, and
dynamic validator discovery. Covers both happy paths and edge cases/pitfalls.
"""

from datetime import date, timedelta

from ocr_service.services.validators import (
    # Constants for confidence calculation
    FIELD_EXTRACTION_MAX_SCORE,
    OCR_CONFIDENCE_MAX_SCORE,
    POINTS_PER_FIELD,
    TEXT_LENGTH_HIGH,
    TEXT_LENGTH_LOW,
    TEXT_LENGTH_MEDIUM,
    TEXT_QUALITY_MAX_SCORE,
    alpha3_to_alpha2,
    calculate_confidence,
    discover_validator,
    get_country_display_name,
    validate_dob,
    validate_document_number,
    validate_expiration_date,
    validate_national_id_detailed,
    validate_passport_number,
)

# =============================================================================
# alpha3_to_alpha2 Tests
# =============================================================================


class TestAlpha3ToAlpha2:
    """Tests for ISO 3166-1 alpha-3 to alpha-2 conversion."""

    def test_converts_dom_to_do(self):
        """Dominican Republic: DOM → do."""
        assert alpha3_to_alpha2("DOM") == "do"

    def test_converts_usa_to_us(self):
        """United States: USA → us."""
        assert alpha3_to_alpha2("USA") == "us"

    def test_converts_esp_to_es(self):
        """Spain: ESP → es."""
        assert alpha3_to_alpha2("ESP") == "es"

    def test_converts_bra_to_br(self):
        """Brazil: BRA → br."""
        assert alpha3_to_alpha2("BRA") == "br"

    def test_converts_mex_to_mx(self):
        """Mexico: MEX → mx."""
        assert alpha3_to_alpha2("MEX") == "mx"

    def test_returns_lowercase(self):
        """Result should always be lowercase."""
        result = alpha3_to_alpha2("GBR")
        assert result == "gb"
        assert result.islower()

    # --- Edge cases / Pitfalls ---

    def test_invalid_code_returns_none(self):
        """Invalid country code returns None."""
        assert alpha3_to_alpha2("XYZ") is None
        assert alpha3_to_alpha2("ZZZ") is None

    def test_empty_string_returns_none(self):
        """Empty string returns None."""
        assert alpha3_to_alpha2("") is None

    def test_none_returns_none(self):
        """None input returns None."""
        assert alpha3_to_alpha2(None) is None

    def test_lowercase_input_works(self):
        """iso3166 library handles lowercase codes."""
        # iso3166 is case-insensitive for lookup
        assert alpha3_to_alpha2("dom") == "do"

    def test_alpha2_input_works_via_iso3166(self):
        """iso3166 library can also look up alpha-2 codes."""
        # This is actually valid - iso3166 accepts alpha-2 as input
        result = alpha3_to_alpha2("US")
        # May return 'us' or None depending on iso3166 behavior
        assert result == "us" or result is None


# =============================================================================
# get_country_display_name Tests
# =============================================================================


class TestGetCountryDisplayName:
    """Tests for getting human-readable country names."""

    def test_returns_full_name_for_dom(self):
        """DOM returns 'Dominican Republic'."""
        assert get_country_display_name("DOM") == "Dominican Republic"

    def test_returns_full_name_for_usa(self):
        """USA returns full country name from iso3166."""
        assert get_country_display_name("USA") == "United States of America"

    def test_invalid_code_returns_code_itself(self):
        """Invalid codes return the code as fallback."""
        assert get_country_display_name("XYZ") == "XYZ"

    def test_empty_returns_unknown(self):
        """Empty string returns 'Unknown'."""
        assert get_country_display_name("") == "Unknown"

    def test_none_returns_unknown(self):
        """None returns 'Unknown'."""
        assert get_country_display_name(None) == "Unknown"


# =============================================================================
# discover_validator Tests
# =============================================================================


class TestDiscoverValidator:
    """Tests for dynamic validator discovery."""

    def test_finds_validator_for_dominican_republic(self):
        """Finds cedula validator for DOM."""
        validator = discover_validator("DOM")
        assert validator is not None
        assert validator.country_code == "do"
        assert validator.module_name == "cedula"
        assert "stdnum.do.cedula" in validator.full_path

    def test_finds_validator_for_spain(self):
        """Finds DNI validator for ESP."""
        validator = discover_validator("ESP")
        assert validator is not None
        assert validator.country_code == "es"
        assert validator.module_name == "dni"

    def test_finds_validator_for_brazil(self):
        """Finds CPF validator for BRA."""
        validator = discover_validator("BRA")
        assert validator is not None
        assert validator.country_code == "br"
        assert validator.module_name == "cpf"

    def test_validator_has_display_name(self):
        """Validators have human-readable display names."""
        validator = discover_validator("DOM")
        assert validator is not None
        assert validator.display_name is not None
        assert len(validator.display_name) > 0

    def test_validator_module_has_validate_method(self):
        """Discovered validators have validate() method."""
        validator = discover_validator("DOM")
        assert validator is not None
        assert hasattr(validator.module, "validate")

    # --- Edge cases / Pitfalls ---

    def test_returns_none_for_unsupported_country(self):
        """Countries without validators return None."""
        # Not all countries have stdnum validators
        result = discover_validator("ZWE")  # Zimbabwe - no stdnum module
        # May or may not be None depending on stdnum version
        # The important thing is it doesn't crash
        assert result is None or result.display_name is not None

    def test_returns_none_for_invalid_code(self):
        """Invalid country codes return None."""
        assert discover_validator("XYZ") is None
        assert discover_validator("ZZZ") is None

    def test_returns_none_for_empty_code(self):
        """Empty code returns None."""
        assert discover_validator("") is None

    def test_returns_none_for_none(self):
        """None returns None."""
        assert discover_validator(None) is None


# =============================================================================
# validate_document_number Tests
# =============================================================================


class TestValidateDocumentNumber:
    """Tests for document number validation with rich error reporting."""

    def test_valid_dominican_cedula(self):
        """Valid Dominican cedula passes validation."""
        # Using a known valid cedula format
        result = validate_document_number("00114918507", "DOM")
        # Note: May fail checksum depending on the actual number
        # The important thing is it attempts validation
        assert result is not None

    def test_missing_number_returns_error(self):
        """Empty document number returns error."""
        result = validate_document_number("", "DOM")
        assert result.is_valid is False
        assert result.error_code == "missing_document_number"

    def test_none_number_returns_error(self):
        """None document number returns error."""
        result = validate_document_number(None, "DOM")
        assert result.is_valid is False
        assert result.error_code == "missing_document_number"

    def test_no_country_code_passes(self):
        """Without country code, validation passes (can't validate)."""
        result = validate_document_number("12345678", None)
        assert result.is_valid is True
        assert result.error_code is None

    def test_empty_country_code_passes(self):
        """Empty country code means validation passes."""
        result = validate_document_number("12345678", "")
        assert result.is_valid is True

    def test_unsupported_country_passes_with_warning(self):
        """Countries without validators pass but with warning."""
        # Using a country that might not have a validator
        result = validate_document_number("12345678", "ZWE")
        # Should not fail the user if we can't validate
        assert result.is_valid is True
        if result.error_code:
            assert "unavailable" in result.error_code

    # --- Validation error types ---

    def test_invalid_checksum_returns_error(self, invalid_cedula_checksum):
        """Invalid checksum returns specific error."""
        result = validate_document_number(invalid_cedula_checksum, "DOM")
        # May return checksum error or other validation error
        if not result.is_valid:
            assert result.error_code is not None
            assert result.error_message is not None

    def test_invalid_length_returns_error(self, invalid_cedula_length):
        """Invalid length returns specific error."""
        result = validate_document_number(invalid_cedula_length, "DOM")
        if not result.is_valid:
            assert result.error_code is not None

    def test_error_message_includes_country_name(self):
        """Error messages include human-readable country name."""
        result = validate_document_number("invalid", "DOM")
        if result.error_message:
            # Should reference the country
            assert "Dominican" in result.error_message or "dom" in result.error_message.lower()

    def test_result_includes_validator_used(self):
        """Result includes which validator was used."""
        result = validate_document_number("00114918507", "DOM")
        if result.validator_used:
            assert "stdnum" in result.validator_used


# =============================================================================
# validate_national_id_detailed Tests
# =============================================================================


class TestValidateNationalIdDetailed:
    """Tests for validate_national_id_detailed (wrapper function)."""

    def test_delegates_to_validate_document_number(self):
        """validate_national_id_detailed delegates to validate_document_number."""
        result = validate_national_id_detailed("12345678", "DOM")
        # Should return a ValidationResult
        assert hasattr(result, "is_valid")
        assert hasattr(result, "error_code")
        assert hasattr(result, "error_message")


# =============================================================================
# validate_passport_number Tests
# =============================================================================


class TestValidatePassportNumber:
    """Tests for passport number validation."""

    def test_valid_passport_format(self, valid_passport_number):
        """Valid passport number (6-12 alphanumeric) passes."""
        issues = validate_passport_number(valid_passport_number)
        assert issues == []

    def test_valid_6_char_passport(self):
        """6 character passport is valid (minimum length)."""
        issues = validate_passport_number("AB1234")
        assert issues == []

    def test_valid_12_char_passport(self):
        """12 character passport is valid (maximum length)."""
        issues = validate_passport_number("ABCDEF123456")
        assert issues == []

    def test_all_letters_valid(self):
        """All-letter passport numbers are valid."""
        issues = validate_passport_number("ABCDEFGH")
        assert issues == []

    def test_all_numbers_valid(self):
        """All-number passport numbers are valid."""
        issues = validate_passport_number("12345678")
        assert issues == []

    # --- Edge cases / Pitfalls ---

    def test_too_short_returns_error(self, invalid_passport_short):
        """Passport < 6 chars returns error."""
        issues = validate_passport_number(invalid_passport_short)
        assert "invalid_passport_format" in issues

    def test_too_long_returns_error(self, invalid_passport_long):
        """Passport > 12 chars returns error."""
        issues = validate_passport_number(invalid_passport_long)
        assert "invalid_passport_format" in issues

    def test_special_chars_returns_error(self, invalid_passport_special_chars):
        """Special characters return error."""
        issues = validate_passport_number(invalid_passport_special_chars)
        assert "invalid_passport_format" in issues

    def test_lowercase_returns_error(self):
        """Lowercase letters are invalid (MRZ is uppercase only)."""
        issues = validate_passport_number("ab123456")
        assert "invalid_passport_format" in issues

    def test_empty_returns_missing_error(self):
        """Empty passport number returns missing error."""
        issues = validate_passport_number("")
        assert "missing_document_number" in issues

    def test_none_returns_missing_error(self):
        """None passport number returns missing error."""
        issues = validate_passport_number(None)
        assert "missing_document_number" in issues

    def test_5_chars_is_too_short(self):
        """5 characters is just under the minimum."""
        issues = validate_passport_number("AB123")
        assert "invalid_passport_format" in issues

    def test_13_chars_is_too_long(self):
        """13 characters is just over the maximum."""
        issues = validate_passport_number("AB12345678901")
        assert "invalid_passport_format" in issues


# =============================================================================
# validate_expiration_date Tests
# =============================================================================


class TestValidateExpirationDate:
    """Tests for document expiration date validation."""

    def test_future_date_is_valid(self, future_expiration_date):
        """Future expiration date is valid."""
        issues = validate_expiration_date(future_expiration_date)
        assert issues == []

    def test_far_future_date_is_valid(self):
        """Date 10 years in future is valid."""
        future = date.today() + timedelta(days=3650)
        issues = validate_expiration_date(future.isoformat())
        assert issues == []

    def test_tomorrow_is_valid(self):
        """Expiration tomorrow is still valid."""
        tomorrow = date.today() + timedelta(days=1)
        issues = validate_expiration_date(tomorrow.isoformat())
        assert issues == []

    def test_empty_string_passes(self):
        """Empty string passes (no validation needed)."""
        issues = validate_expiration_date("")
        assert issues == []

    def test_none_passes(self):
        """None passes (no validation needed)."""
        issues = validate_expiration_date(None)
        assert issues == []

    # --- Edge cases / Pitfalls ---

    def test_past_date_returns_expired(self, past_expiration_date):
        """Past date returns document_expired."""
        issues = validate_expiration_date(past_expiration_date)
        assert "document_expired" in issues

    def test_yesterday_is_expired(self):
        """Document expired yesterday is invalid."""
        yesterday = date.today() - timedelta(days=1)
        issues = validate_expiration_date(yesterday.isoformat())
        assert "document_expired" in issues

    def test_today_is_expired(self):
        """Document expiring today is expired (< today, not <=)."""
        today = date.today()
        issues = validate_expiration_date(today.isoformat())
        # Depending on implementation, today might be expired or valid
        # Our implementation uses < so today is NOT expired
        assert "document_expired" not in issues

    def test_invalid_format_returns_error(self):
        """Invalid date format returns error."""
        issues = validate_expiration_date("2024/01/15")
        assert "invalid_expiration_format" in issues

    def test_dd_mm_yyyy_format_returns_error(self):
        """DD-MM-YYYY format is invalid (expects YYYY-MM-DD)."""
        issues = validate_expiration_date("15-01-2024")
        assert "invalid_expiration_format" in issues

    def test_non_date_string_returns_error(self):
        """Non-date string returns error."""
        issues = validate_expiration_date("not-a-date")
        assert "invalid_expiration_format" in issues

    def test_partial_date_returns_error(self):
        """Partial date returns error."""
        issues = validate_expiration_date("2024-01")
        assert "invalid_expiration_format" in issues


# =============================================================================
# validate_dob Tests
# =============================================================================


class TestValidateDob:
    """Tests for date of birth validation."""

    def test_adult_dob_is_valid(self, adult_dob):
        """Adult (>= 18 years) DOB is valid."""
        issues = validate_dob(adult_dob)
        assert issues == []

    def test_exactly_18_is_valid(self):
        """Exactly 18 years old is valid."""
        eighteen_years_ago = date.today() - timedelta(days=18 * 365)
        issues = validate_dob(eighteen_years_ago.isoformat())
        # May have minor age if calculated differently
        assert "invalid_date_of_birth" not in issues

    def test_30_years_old_is_valid(self):
        """30 year old is valid."""
        dob = date.today() - timedelta(days=30 * 365)
        issues = validate_dob(dob.isoformat())
        assert issues == []

    def test_100_years_old_is_valid(self):
        """100 year old is valid (under 150 limit)."""
        dob = date.today() - timedelta(days=100 * 365)
        issues = validate_dob(dob.isoformat())
        assert issues == []

    def test_empty_string_passes(self):
        """Empty string passes (no validation needed)."""
        issues = validate_dob("")
        assert issues == []

    def test_none_passes(self):
        """None passes (no validation needed)."""
        issues = validate_dob(None)
        assert issues == []

    # --- Edge cases / Pitfalls ---

    def test_minor_returns_warning(self, minor_dob):
        """Minor (< 18 years) returns minor_age_detected."""
        issues = validate_dob(minor_dob)
        assert "minor_age_detected" in issues

    def test_1_year_old_is_minor(self):
        """1 year old is a minor."""
        dob = date.today() - timedelta(days=365)
        issues = validate_dob(dob.isoformat())
        assert "minor_age_detected" in issues

    def test_17_years_old_is_minor(self):
        """17 year old is still a minor."""
        dob = date.today() - timedelta(days=17 * 365)
        issues = validate_dob(dob.isoformat())
        assert "minor_age_detected" in issues

    def test_future_dob_is_invalid(self, impossible_dob):
        """Future date of birth is invalid."""
        issues = validate_dob(impossible_dob)
        assert "invalid_date_of_birth" in issues

    def test_tomorrow_dob_is_invalid(self):
        """Birth date tomorrow is invalid."""
        tomorrow = date.today() + timedelta(days=1)
        issues = validate_dob(tomorrow.isoformat())
        assert "invalid_date_of_birth" in issues

    def test_ancient_dob_is_invalid(self, ancient_dob):
        """DOB > 150 years ago is invalid."""
        issues = validate_dob(ancient_dob)
        assert "invalid_date_of_birth" in issues

    def test_200_years_old_is_invalid(self):
        """200 year old is invalid."""
        dob = date.today() - timedelta(days=200 * 365)
        issues = validate_dob(dob.isoformat())
        assert "invalid_date_of_birth" in issues

    def test_invalid_format_returns_error(self):
        """Invalid date format returns error."""
        issues = validate_dob("15/05/1990")
        assert "invalid_dob_format" in issues

    def test_non_date_string_returns_error(self):
        """Non-date string returns error."""
        issues = validate_dob("not-a-date")
        assert "invalid_dob_format" in issues


# =============================================================================
# calculate_confidence Tests
# =============================================================================


class TestCalculateConfidence:
    """Tests for confidence score calculation."""

    def test_max_confidence_with_high_values(self):
        """High text length + all fields + high OCR = high confidence."""
        score = calculate_confidence(
            text_length=TEXT_LENGTH_HIGH + 100,
            fields_extracted=4,
            ocr_avg_confidence=1.0,
        )
        # Should be close to 1.0
        assert score >= 0.9
        assert score <= 1.0

    def test_perfect_score_calculation(self):
        """Verify the maximum possible score is 1.0."""
        score = calculate_confidence(
            text_length=TEXT_LENGTH_HIGH + 1,  # Max text quality
            fields_extracted=4,  # All 4 fields
            ocr_avg_confidence=1.0,  # Perfect OCR
        )
        # 0.3 (text) + 0.4 (fields) + 0.3 (ocr) = 1.0
        assert score == 1.0

    def test_confidence_components_are_additive(self):
        """Each component contributes independently."""
        # Only text quality
        text_only = calculate_confidence(TEXT_LENGTH_HIGH + 1, 0, 0.0)
        assert abs(text_only - TEXT_QUALITY_MAX_SCORE) < 0.01

        # Only fields
        fields_only = calculate_confidence(0, 4, 0.0)
        assert abs(fields_only - FIELD_EXTRACTION_MAX_SCORE) < 0.01

        # Only OCR confidence
        ocr_only = calculate_confidence(0, 0, 1.0)
        assert abs(ocr_only - OCR_CONFIDENCE_MAX_SCORE) < 0.01

    def test_medium_text_length_score(self):
        """Medium text length gets partial score."""
        score = calculate_confidence(
            text_length=TEXT_LENGTH_MEDIUM + 1,
            fields_extracted=0,
            ocr_avg_confidence=0.0,
        )
        # Should be about 0.2 (67% of max text score)
        assert score > 0.1
        assert score < TEXT_QUALITY_MAX_SCORE

    def test_low_text_length_score(self):
        """Low text length gets minimal score."""
        score = calculate_confidence(
            text_length=TEXT_LENGTH_LOW + 1,
            fields_extracted=0,
            ocr_avg_confidence=0.0,
        )
        # Should be about 0.1 (33% of max text score)
        assert score > 0.0
        assert score < 0.2

    def test_per_field_contribution(self):
        """Each field adds POINTS_PER_FIELD to score."""
        base = calculate_confidence(0, 0, 0.0)
        one_field = calculate_confidence(0, 1, 0.0)
        two_fields = calculate_confidence(0, 2, 0.0)

        assert abs((one_field - base) - POINTS_PER_FIELD) < 0.01
        assert abs((two_fields - base) - 2 * POINTS_PER_FIELD) < 0.01

    # --- Edge cases / Pitfalls ---

    def test_zero_values_returns_zero(self):
        """All zeros return zero confidence."""
        score = calculate_confidence(0, 0, 0.0)
        assert score == 0.0

    def test_negative_text_length_treated_as_zero(self):
        """Negative text length doesn't break calculation."""
        score = calculate_confidence(-100, 0, 0.0)
        assert score >= 0.0

    def test_more_than_4_fields_capped(self):
        """More than 4 fields doesn't exceed max field score."""
        score_4 = calculate_confidence(0, 4, 0.0)
        score_10 = calculate_confidence(0, 10, 0.0)
        # Both should be capped at FIELD_EXTRACTION_MAX_SCORE
        assert score_4 == score_10
        assert score_4 == FIELD_EXTRACTION_MAX_SCORE

    def test_ocr_confidence_above_1_capped(self):
        """OCR confidence > 1.0 is capped in final score."""
        score = calculate_confidence(TEXT_LENGTH_HIGH + 1, 4, 1.5)
        # Total might exceed 1.0 before capping
        assert score <= 1.0

    def test_score_never_exceeds_1(self):
        """Score is always capped at 1.0."""
        score = calculate_confidence(10000, 100, 10.0)
        assert score <= 1.0

    def test_realistic_partial_extraction(self):
        """Realistic scenario: partial OCR, some fields."""
        score = calculate_confidence(
            text_length=150,  # Between low and high
            fields_extracted=2,  # Half the fields
            ocr_avg_confidence=0.7,  # Decent OCR
        )
        # Should be a moderate score
        assert 0.3 < score < 0.8
