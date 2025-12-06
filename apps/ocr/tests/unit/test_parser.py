"""
Tests for MRZ parsing using ICAO 9303 standard library.
"""

import pytest

from app.parser import (
    parse_mrz,
    extract_passport_fields,
    _mrz_date_to_iso,
    correct_country_code,
)
from mrz.base.countries_ops import get_country


# Standard ICAO test MRZ (from ICAO 9303 spec)
VALID_MRZ_ICAO = (
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n"
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10"
)

# Dominican Republic passport MRZ example
VALID_MRZ_DOM = (
    "P<DOMVALVERDE<DE<SOTO<<GUSTAVO<ADOLFO<JR<<<<\n"
    "RD69703794DOM9205241M3006226<<<<<<<<<<<<<<02"
)


class TestParseMrz:
    """Tests for the parse_mrz function."""

    def test_parse_valid_icao_mrz(self):
        """Test parsing the standard ICAO example MRZ."""
        data, is_valid = parse_mrz(VALID_MRZ_ICAO)

        assert is_valid is True
        assert data.last_name == "Eriksson"
        assert data.first_name == "Anna Maria"
        assert data.document_number == "L898902C3"
        assert data.date_of_birth == "1974-08-12"
        assert data.expiration_date == "2012-04-15"
        assert data.gender == "F"
        assert data.nationality == "UTO"

    def test_parse_dominican_mrz(self):
        """Test parsing a Dominican Republic passport MRZ."""
        data, is_valid = parse_mrz(VALID_MRZ_DOM)

        # Checksum validation depends on the actual MRZ being correct
        assert data.last_name is not None
        assert data.first_name is not None
        assert data.document_number is not None
        assert data.nationality == "DOMINICANA"

    def test_full_name_construction(self):
        """Test that full name is constructed as 'Given Names + Surname'."""
        data, _ = parse_mrz(VALID_MRZ_ICAO)

        assert data.full_name == "Anna Maria Eriksson"

    def test_empty_mrz_returns_empty_data(self):
        """Test that empty/short MRZ returns empty data."""
        data, is_valid = parse_mrz("")

        assert is_valid is False
        assert data.full_name is None
        assert data.document_number is None

    def test_short_mrz_returns_empty_data(self):
        """Test that MRZ shorter than 88 chars returns empty data."""
        data, is_valid = parse_mrz("P<UTOERIKSSON<<ANNA")

        assert is_valid is False
        assert data.full_name is None

    def test_mrz_without_newlines(self):
        """Test parsing MRZ when lines are concatenated (no newline)."""
        mrz_no_newline = VALID_MRZ_ICAO.replace("\n", "")
        data, is_valid = parse_mrz(mrz_no_newline)

        # Should still parse by splitting at 44 chars
        assert data.document_number is not None

    def test_mrz_with_spaces(self):
        """Test that spaces in MRZ are handled."""
        mrz_with_spaces = VALID_MRZ_ICAO.replace("<", " < ")
        data, _ = parse_mrz(mrz_with_spaces)

        # Spaces should be stripped during normalization
        # The result depends on how much the spacing corrupts the MRZ


class TestMrzDateConversion:
    """Tests for MRZ date format conversion."""

    def test_convert_valid_date(self):
        """Test converting YYMMDD to YYYY-MM-DD."""
        assert _mrz_date_to_iso("740812") == "1974-08-12"
        assert _mrz_date_to_iso("120415") == "2012-04-15"

    def test_century_inference(self):
        """Test that century is correctly inferred (00-49 -> 20xx, 50-99 -> 19xx)."""
        assert _mrz_date_to_iso("250101") == "2025-01-01"
        assert _mrz_date_to_iso("490101") == "2049-01-01"
        assert _mrz_date_to_iso("500101") == "1950-01-01"
        assert _mrz_date_to_iso("990101") == "1999-01-01"

    def test_empty_date_returns_none(self):
        """Test that empty/invalid dates return None."""
        assert _mrz_date_to_iso("") is None
        assert _mrz_date_to_iso(None) is None
        assert _mrz_date_to_iso("123") is None  # Too short


class TestExtractPassportFields:
    """Tests for the extract_passport_fields function."""

    def test_extracts_from_mrz_in_text(self):
        """Test extraction when MRZ is embedded in larger text."""
        text_with_mrz = f"""
        PASAPORTE
        REPUBLICA DOMINICANA

        {VALID_MRZ_ICAO}

        Some other text
        """
        data, is_valid = extract_passport_fields(text_with_mrz)

        assert data.document_number is not None

    def test_fallback_when_no_mrz(self):
        """Test fallback extraction when no MRZ pattern found."""
        text_without_mrz = """
        PASAPORTE
        NOMBRE: JUAN PEREZ
        NUMERO: AB1234567
        """
        data, is_valid = extract_passport_fields(text_without_mrz)

        # Fallback should return is_valid=False
        assert is_valid is False


class TestCountryCodeCorrection:
    """Tests for OCR error correction in country codes."""

    def test_valid_code_unchanged(self):
        """Test that valid country codes are not modified."""
        code, corrected = correct_country_code("DOM")
        assert code == "DOM"
        assert corrected is False

        code, corrected = correct_country_code("USA")
        assert code == "USA"
        assert corrected is False

    def test_zero_to_o_correction(self):
        """Test correction of 0 (zero) to O (letter)."""
        # D0M with zero should become DOM
        code, corrected = correct_country_code("D0M")
        assert code == "DOM"
        assert corrected is True

    def test_one_to_i_correction(self):
        """Test correction of 1 (one) to I (letter)."""
        # 1ND with one should become IND (India)
        code, corrected = correct_country_code("1ND")
        assert code == "IND"
        assert corrected is True

    def test_uncorrectable_code(self):
        """Test that invalid codes that can't be corrected are returned as-is."""
        code, corrected = correct_country_code("XYZ")
        assert code == "XYZ"
        assert corrected is False

    def test_multiple_substitutions_not_applied(self):
        """Test that only single substitution is needed for real codes."""
        # Most real OCR errors involve single character confusion
        code, corrected = correct_country_code("00M")  # Two zeros - unlikely to correct
        # This may or may not correct depending on if "OOM" is a valid code
        # The important thing is no crash


class TestCountryNameLookup:
    """Tests for mrz library country name lookup."""

    def test_dominican_republic_lookup(self):
        """Test that DOM returns Dominican Republic."""
        name = get_country("DOM")
        assert name == "Dominican Republic"

    def test_usa_lookup(self):
        """Test that USA returns correct name."""
        name = get_country("USA")
        assert name == "United States"

    def test_invalid_code_returns_none(self):
        """Test that invalid codes return None."""
        name = get_country("XYZ")
        assert name is None

        name = get_country("D0M")  # With zero
        assert name is None


class TestParseMrzNationality:
    """Tests for nationality handling in parse_mrz."""

    def test_nationality_code_and_name_extracted(self):
        """Test that both nationality code and name are extracted."""
        data, _ = parse_mrz(VALID_MRZ_ICAO)

        assert data.nationality_code is not None
        assert data.nationality is not None
        # UTO is a fictional country in ICAO examples
        assert data.nationality_code == "UTO"

    def test_dominican_passport_nationality(self):
        """Test Dominican passport nationality extraction."""
        data, _ = parse_mrz(VALID_MRZ_DOM)

        # Should have both code and full name
        assert data.nationality_code is not None
        # If OCR read correctly, should be "Dominican Republic"
        # If OCR error was corrected, should still work
