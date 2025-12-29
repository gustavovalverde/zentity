"""
Unit tests for the document_detector module.

Tests document type detection from OCR text. Covers detection of passports,
national IDs, driver's licenses, and edge cases with mixed/ambiguous text.
"""

import pytest

from ocr_service.services.document_detector import (
    DOCUMENT_MARKERS,
    DocumentType,
    detect_document_type,
)

# =============================================================================
# Basic Document Type Detection Tests
# =============================================================================


class TestDetectPassport:
    """Tests for passport document detection."""

    def test_detects_passport_from_pasaporte(self):
        """Spanish 'PASAPORTE' keyword triggers passport detection."""
        doc_type, confidence = detect_document_type("PASAPORTE REPUBLICA DOMINICANA")
        assert doc_type == DocumentType.PASSPORT

    def test_detects_passport_from_passport(self):
        """English 'PASSPORT' keyword triggers passport detection."""
        doc_type, confidence = detect_document_type("PASSPORT UNITED STATES OF AMERICA")
        assert doc_type == DocumentType.PASSPORT

    def test_detects_passport_from_reisepass(self):
        """German 'REISEPASS' keyword triggers passport detection."""
        doc_type, confidence = detect_document_type("REISEPASS BUNDESREPUBLIK DEUTSCHLAND")
        assert doc_type == DocumentType.PASSPORT

    def test_detects_passport_from_passeport(self):
        """French 'PASSEPORT' keyword triggers passport detection."""
        doc_type, confidence = detect_document_type("PASSEPORT REPUBLIQUE FRANCAISE")
        assert doc_type == DocumentType.PASSPORT

    def test_detects_passport_from_mrz_indicator(self):
        """MRZ indicator 'P<DOM' triggers passport detection."""
        doc_type, confidence = detect_document_type("P<DOMSMITH<<JOHN<<<<<<<<<<<<<<<<<<<<<<")
        assert doc_type == DocumentType.PASSPORT
        # MRZ is a strong signal - should have high confidence
        assert confidence == 1.0

    def test_detects_passport_from_type_p(self):
        """'TIPO/TYPE P' format triggers passport detection."""
        doc_type, confidence = detect_document_type("TIPO / TYPE P PASSPORT")
        assert doc_type == DocumentType.PASSPORT

    def test_mrz_fast_path_takes_precedence(self):
        """MRZ indicator 'P<XXX' takes precedence over other markers."""
        # Text has both passport and ID markers, but P< should win
        text = "CEDULA DE IDENTIDAD P<USA"
        doc_type, confidence = detect_document_type(text)
        assert doc_type == DocumentType.PASSPORT
        assert confidence == 1.0


class TestDetectNationalId:
    """Tests for national ID document detection."""

    def test_detects_national_id_from_cedula(self):
        """Spanish 'CEDULA DE IDENTIDAD' triggers national ID detection."""
        doc_type, confidence = detect_document_type("CEDULA DE IDENTIDAD REPUBLICA DOMINICANA")
        assert doc_type == DocumentType.NATIONAL_ID

    def test_detects_national_id_from_jce(self):
        """'JUNTA CENTRAL ELECTORAL' triggers national ID detection."""
        doc_type, confidence = detect_document_type("JUNTA CENTRAL ELECTORAL 001-1234567-8")
        assert doc_type == DocumentType.NATIONAL_ID

    def test_detects_national_id_from_jce_abbreviation(self):
        """'JCE' abbreviation triggers national ID detection."""
        doc_type, confidence = detect_document_type("JCE CEDULA ELECTORAL")
        assert doc_type == DocumentType.NATIONAL_ID

    def test_detects_national_id_from_dni(self):
        """'DNI' (Spanish national ID) triggers detection."""
        doc_type, confidence = detect_document_type("DNI ESPANA 12345678A")
        assert doc_type == DocumentType.NATIONAL_ID

    def test_detects_national_id_from_documento_nacional(self):
        """'DOCUMENTO NACIONAL' triggers detection."""
        doc_type, confidence = detect_document_type("DOCUMENTO NACIONAL DE IDENTIDAD")
        assert doc_type == DocumentType.NATIONAL_ID

    def test_detects_national_id_from_identity_card(self):
        """English 'IDENTITY CARD' triggers detection."""
        doc_type, confidence = detect_document_type("NATIONAL IDENTITY CARD")
        assert doc_type == DocumentType.NATIONAL_ID

    def test_detects_from_dominican_cedula_format(self):
        """Dominican cedula number format triggers detection."""
        doc_type, confidence = detect_document_type("001-1234567-8")
        assert doc_type == DocumentType.NATIONAL_ID

    def test_detects_from_spanish_dni_format(self):
        """Spanish DNI format (8 digits + letter) triggers detection."""
        doc_type, confidence = detect_document_type("12345678A NOMBRE APELLIDO")
        assert doc_type == DocumentType.NATIONAL_ID


class TestDetectDriversLicense:
    """Tests for driver's license detection."""

    def test_detects_license_from_licencia(self):
        """Spanish 'LICENCIA DE CONDUCIR' triggers detection."""
        doc_type, confidence = detect_document_type("LICENCIA DE CONDUCIR CATEGORIA B")
        assert doc_type == DocumentType.DRIVERS_LICENSE

    def test_detects_license_from_drivers_license(self):
        """English 'DRIVER'S LICENSE' triggers detection."""
        doc_type, confidence = detect_document_type("DRIVER'S LICENSE STATE OF CALIFORNIA")
        assert doc_type == DocumentType.DRIVERS_LICENSE

    def test_detects_license_from_driving_licence(self):
        """British 'DRIVING LICENCE' triggers detection."""
        doc_type, confidence = detect_document_type("DRIVING LICENCE UNITED KINGDOM")
        assert doc_type == DocumentType.DRIVERS_LICENSE

    def test_detects_license_from_permis(self):
        """French 'PERMIS DE CONDUIRE' triggers detection."""
        doc_type, confidence = detect_document_type("PERMIS DE CONDUIRE FRANCE")
        assert doc_type == DocumentType.DRIVERS_LICENSE

    def test_detects_license_from_fuhrerschein(self):
        """German 'FÜHRERSCHEIN' (with umlaut) triggers detection."""
        # Note: The pattern uses FÜHRERSCHEIN with umlaut, not FUHRERSCHEIN
        doc_type, confidence = detect_document_type("FÜHRERSCHEIN DEUTSCHLAND")
        assert doc_type == DocumentType.DRIVERS_LICENSE

    def test_detects_license_from_categoria(self):
        """'CATEGORIA' (category) suggests driver's license."""
        doc_type, confidence = detect_document_type("LICENCIA CATEGORÍA B C1")
        assert doc_type == DocumentType.DRIVERS_LICENSE

    def test_detects_license_from_category(self):
        """'CATEGORY' suggests driver's license."""
        doc_type, confidence = detect_document_type("LICENSE CATEGORY A B C D")
        assert doc_type == DocumentType.DRIVERS_LICENSE


# =============================================================================
# Edge Cases and Pitfalls
# =============================================================================


class TestUnknownDocumentType:
    """Tests for unknown/undetectable document types."""

    def test_empty_text_returns_unknown(self, empty_document_text):
        """Empty text returns UNKNOWN with 0.0 confidence."""
        doc_type, confidence = detect_document_type(empty_document_text)
        assert doc_type == DocumentType.UNKNOWN
        assert confidence == 0.0

    def test_gibberish_returns_unknown(self, gibberish_text):
        """Random text without markers returns UNKNOWN."""
        doc_type, confidence = detect_document_type(gibberish_text)
        assert doc_type == DocumentType.UNKNOWN
        assert confidence == 0.0

    def test_long_numbers_may_match_id_patterns(self):
        """Long numbers may match ID number patterns."""
        # 9-12 digit patterns match as generic national ID numbers
        doc_type, confidence = detect_document_type("123456789 987654321")
        # This matches the generic 9-12 digit ID pattern
        assert doc_type in [DocumentType.NATIONAL_ID, DocumentType.UNKNOWN]

    def test_short_text_returns_unknown(self):
        """Very short text returns UNKNOWN."""
        doc_type, confidence = detect_document_type("ABC")
        assert doc_type == DocumentType.UNKNOWN


class TestCaseInsensitivity:
    """Tests for case-insensitive matching."""

    def test_lowercase_passport_detected(self):
        """Lowercase 'passport' is detected."""
        doc_type, _ = detect_document_type("passport united states")
        assert doc_type == DocumentType.PASSPORT

    def test_lowercase_cedula_detected(self):
        """Lowercase 'cedula de identidad' is detected."""
        doc_type, _ = detect_document_type("cedula de identidad dominicana")
        assert doc_type == DocumentType.NATIONAL_ID

    def test_mixed_case_detected(self):
        """Mixed case 'PasSPort' is detected."""
        doc_type, _ = detect_document_type("PasSPort UnitED StateS")
        assert doc_type == DocumentType.PASSPORT


class TestMixedDocumentMarkers:
    """Tests for text with markers from multiple document types."""

    def test_mixed_passport_and_id_prefers_highest_score(self, mixed_document_text):
        """Mixed markers go to highest scoring type."""
        doc_type, confidence = detect_document_type(mixed_document_text)
        # P<DOM is a passport MRZ indicator - should take precedence
        assert doc_type == DocumentType.PASSPORT
        assert confidence == 1.0

    def test_more_id_markers_than_passport(self):
        """More ID markers should win if no MRZ present."""
        text = """
        CEDULA DE IDENTIDAD
        JUNTA CENTRAL ELECTORAL
        DNI DOCUMENTO NACIONAL
        PASSPORT
        """
        doc_type, _ = detect_document_type(text)
        # Multiple ID markers vs one passport marker
        assert doc_type == DocumentType.NATIONAL_ID

    def test_more_license_markers_wins(self):
        """More license markers should win over single ID marker."""
        text = """
        LICENCIA DE CONDUCIR
        CATEGORIA B C
        DRIVING LICENSE
        DNI
        """
        doc_type, _ = detect_document_type(text)
        # License has more markers
        assert doc_type == DocumentType.DRIVERS_LICENSE


class TestConfidenceScoring:
    """Tests for confidence score calculation."""

    def test_mrz_indicator_has_max_confidence(self):
        """MRZ P<XXX indicator should have 1.0 confidence."""
        doc_type, confidence = detect_document_type("P<USA")
        assert confidence == 1.0

    def test_single_marker_has_some_confidence(self):
        """Single marker has non-zero confidence."""
        doc_type, confidence = detect_document_type("PASSPORT")
        assert doc_type == DocumentType.PASSPORT
        assert confidence > 0.0

    def test_multiple_markers_increase_confidence(self):
        """Multiple markers should increase confidence."""
        single = detect_document_type("PASSPORT")[1]
        multiple = detect_document_type("PASSPORT PASAPORTE")[1]
        # More markers = higher confidence
        assert multiple >= single

    def test_confidence_never_exceeds_1(self):
        """Confidence is capped at 1.0."""
        # Text with many markers
        text = " ".join(DOCUMENT_MARKERS[DocumentType.PASSPORT])
        _, confidence = detect_document_type(text)
        assert confidence <= 1.0


class TestPartialMatches:
    """Tests for partial/corrupted markers (OCR errors)."""

    def test_partial_passport_not_matched(self):
        """Partial word 'PASS' doesn't trigger passport."""
        doc_type, _ = detect_document_type("PASS WORD")
        assert doc_type == DocumentType.UNKNOWN

    def test_passport_in_other_word_matched(self):
        """'PASSPORT' as substring still matches."""
        # The regex should match the word
        doc_type, _ = detect_document_type("MYPASSPORTDOCUMENT")
        assert doc_type == DocumentType.PASSPORT

    def test_extra_spaces_still_match(self):
        """Extra spaces don't break detection."""
        doc_type, _ = detect_document_type("CEDULA   DE   IDENTIDAD")
        assert doc_type == DocumentType.NATIONAL_ID


class TestRealWorldOcrText:
    """Tests with realistic OCR text patterns."""

    def test_dominican_cedula_ocr_text(self, national_id_text_dominican):
        """Dominican cedula OCR text is detected as national ID."""
        doc_type, confidence = detect_document_type(national_id_text_dominican)
        assert doc_type == DocumentType.NATIONAL_ID
        # Confidence varies based on number of patterns matched
        assert confidence > 0.0

    def test_spanish_dni_ocr_text(self, national_id_text_spanish):
        """Spanish DNI OCR text is detected as national ID."""
        doc_type, confidence = detect_document_type(national_id_text_spanish)
        assert doc_type == DocumentType.NATIONAL_ID

    def test_drivers_license_ocr_text(self, drivers_license_text):
        """Driver's license OCR text is detected correctly."""
        doc_type, confidence = detect_document_type(drivers_license_text)
        assert doc_type == DocumentType.DRIVERS_LICENSE

    def test_passport_mrz_text(self, passport_mrz_text_icao):
        """Passport MRZ text is detected as passport."""
        doc_type, confidence = detect_document_type(passport_mrz_text_icao)
        assert doc_type == DocumentType.PASSPORT
        assert confidence == 1.0


class TestDocumentTypeEnum:
    """Tests for DocumentType enum properties."""

    def test_enum_values_are_strings(self):
        """DocumentType values are strings."""
        assert DocumentType.PASSPORT.value == "passport"
        assert DocumentType.NATIONAL_ID.value == "national_id"
        assert DocumentType.DRIVERS_LICENSE.value == "drivers_license"
        assert DocumentType.UNKNOWN.value == "unknown"

    def test_enum_is_string_subclass(self):
        """DocumentType is a string enum."""
        assert isinstance(DocumentType.PASSPORT, str)
        assert DocumentType.PASSPORT == "passport"


class TestDocumentMarkersConfiguration:
    """Tests for DOCUMENT_MARKERS configuration."""

    def test_all_document_types_have_markers(self):
        """All document types (except UNKNOWN) have markers."""
        assert DocumentType.NATIONAL_ID in DOCUMENT_MARKERS
        assert DocumentType.PASSPORT in DOCUMENT_MARKERS
        assert DocumentType.DRIVERS_LICENSE in DOCUMENT_MARKERS

    def test_markers_are_non_empty(self):
        """Each document type has at least one marker."""
        for doc_type, markers in DOCUMENT_MARKERS.items():
            assert len(markers) > 0, f"{doc_type} has no markers"

    def test_markers_are_regex_patterns(self):
        """Markers are valid regex patterns."""
        import re

        for doc_type, markers in DOCUMENT_MARKERS.items():
            for pattern in markers:
                try:
                    re.compile(pattern)
                except re.error as e:
                    pytest.fail(f"Invalid regex in {doc_type}: {pattern} - {e}")
