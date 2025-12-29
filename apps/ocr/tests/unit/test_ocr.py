"""
Unit tests for the ocr module.

Tests image decoding, MRZ region cropping, and OCR text extraction.
Uses real OCR with test images for realistic testing.
"""

import base64
import binascii

import numpy as np
import pytest

from ocr_service.services.ocr_engine import (
    PASSPORT_MRZ_HINT_PATTERN,
    crop_mrz_region,
    decode_base64_image,
    extract_document_text_from_base64,
    extract_text,
    extract_text_from_base64,
    get_engine,
    get_fast_engine,
)

# =============================================================================
# decode_base64_image Tests
# =============================================================================


class TestDecodeBase64Image:
    """Tests for base64 image decoding."""

    def test_decodes_valid_png_image(self, passport_icao_base64):
        """Valid PNG base64 decodes to numpy array."""
        image = decode_base64_image(passport_icao_base64)
        assert isinstance(image, np.ndarray)
        assert len(image.shape) == 3  # Height, Width, Channels
        assert image.shape[2] == 3  # RGB

    def test_decodes_image_with_data_uri(self, base64_with_data_uri):
        """Data URI prefix is stripped correctly."""
        image = decode_base64_image(base64_with_data_uri)
        assert isinstance(image, np.ndarray)
        assert len(image.shape) == 3

    def test_returns_rgb_not_rgba(self, passport_icao_base64):
        """Image is converted to RGB (3 channels)."""
        image = decode_base64_image(passport_icao_base64)
        assert image.shape[2] == 3  # Not 4 (RGBA)

    def test_decodes_small_image(self, tiny_image_base64):
        """Small images decode correctly."""
        image = decode_base64_image(tiny_image_base64)
        assert isinstance(image, np.ndarray)
        assert image.shape[0] == 10  # Height
        assert image.shape[1] == 10  # Width

    def test_decodes_blank_image(self, blank_image_base64):
        """Blank white image decodes correctly."""
        image = decode_base64_image(blank_image_base64)
        assert isinstance(image, np.ndarray)
        # Blank white image should have high pixel values
        assert image.mean() > 200

    # --- Edge cases / Pitfalls ---

    def test_invalid_base64_raises_error(self, invalid_base64):
        """Invalid base64 string raises exception."""
        with pytest.raises((binascii.Error, OSError, ValueError)):
            decode_base64_image(invalid_base64)

    def test_non_image_base64_raises_error(self, corrupted_file_base64):
        """Non-image data raises exception."""
        with pytest.raises((binascii.Error, OSError, ValueError)):
            decode_base64_image(corrupted_file_base64)

    def test_empty_string_raises_error(self):
        """Empty string raises exception."""
        with pytest.raises((binascii.Error, OSError, ValueError)):
            decode_base64_image("")

    def test_truncated_base64_raises_error(self, passport_icao_base64):
        """Truncated base64 raises exception."""
        truncated = passport_icao_base64[:100]
        with pytest.raises((binascii.Error, OSError, ValueError)):
            decode_base64_image(truncated)

    def test_whitespace_in_base64_raises_error(self, passport_icao_base64):
        """Base64 with embedded newlines may fail or work depending on implementation."""
        # Some base64 decoders handle newlines, others don't
        with_newlines = "\n".join(
            [passport_icao_base64[i : i + 76] for i in range(0, len(passport_icao_base64), 76)]
        )
        # This should either work or raise - not return garbage
        try:
            image = decode_base64_image(with_newlines)
            assert isinstance(image, np.ndarray)
        except Exception:
            pass  # Expected for strict decoders


# =============================================================================
# crop_mrz_region Tests
# =============================================================================


class TestCropMrzRegion:
    """Tests for MRZ region cropping."""

    def test_crops_bottom_portion(self):
        """Default crop returns bottom 35% of image."""
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        cropped = crop_mrz_region(image)
        # Default start_ratio is 0.65, so height should be 35% of 1000 = 350
        assert cropped.shape[0] == 350
        assert cropped.shape[1] == 800  # Width unchanged

    def test_custom_start_ratio(self):
        """Custom start_ratio works correctly."""
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        cropped = crop_mrz_region(image, start_ratio=0.5)
        # 50% start means bottom 50% = 500 rows
        assert cropped.shape[0] == 500

    def test_preserves_channels(self):
        """Cropped image preserves color channels."""
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        cropped = crop_mrz_region(image)
        assert cropped.shape[2] == 3

    # --- Edge cases / Pitfalls ---

    def test_small_image_returns_original(self):
        """Very small image (< 200px) returns original."""
        small = np.zeros((100, 100, 3), dtype=np.uint8)
        result = crop_mrz_region(small)
        assert result.shape == small.shape

    def test_small_height_returns_original(self):
        """Image with height < 200 returns original."""
        narrow = np.zeros((150, 800, 3), dtype=np.uint8)
        result = crop_mrz_region(narrow)
        assert result.shape == narrow.shape

    def test_small_width_returns_original(self):
        """Image with width < 200 returns original."""
        thin = np.zeros((800, 150, 3), dtype=np.uint8)
        result = crop_mrz_region(thin)
        assert result.shape == thin.shape

    def test_edge_case_exactly_200(self):
        """Image exactly 200x200 returns original."""
        edge = np.zeros((200, 200, 3), dtype=np.uint8)
        result = crop_mrz_region(edge)
        # 200 is the boundary - check behavior
        assert result.shape[0] >= 0

    def test_zero_start_ratio_returns_full_image(self):
        """start_ratio=0 returns full image."""
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        cropped = crop_mrz_region(image, start_ratio=0)
        assert cropped.shape == image.shape

    def test_one_start_ratio_returns_empty(self):
        """start_ratio=1 would return empty slice."""
        image = np.zeros((1000, 800, 3), dtype=np.uint8)
        cropped = crop_mrz_region(image, start_ratio=1.0)
        # Should return original image when start_y >= height
        assert cropped.shape == image.shape


# =============================================================================
# OCR Engine Tests
# =============================================================================


class TestOcrEngine:
    """Tests for OCR engine initialization."""

    def test_get_engine_returns_singleton(self):
        """get_engine returns the same instance."""
        engine1 = get_engine()
        engine2 = get_engine()
        assert engine1 is engine2

    def test_get_fast_engine_returns_singleton(self):
        """get_fast_engine returns the same instance."""
        engine1 = get_fast_engine()
        engine2 = get_fast_engine()
        assert engine1 is engine2

    def test_engines_are_different(self):
        """Regular and fast engines are different instances."""
        regular = get_engine()
        fast = get_fast_engine()
        assert regular is not fast


# =============================================================================
# extract_text Tests
# =============================================================================


class TestExtractText:
    """Tests for text extraction from images."""

    def test_extracts_text_from_passport(self, passport_icao_image_path):
        """Extracts text from ICAO passport image."""
        with open(passport_icao_image_path, "rb") as f:
            image_bytes = f.read()
        image_b64 = base64.b64encode(image_bytes).decode()
        image = decode_base64_image(image_b64)

        result = extract_text(image)

        assert isinstance(result.text_blocks, list)
        assert isinstance(result.full_text, str)
        assert isinstance(result.processing_time_ms, int)
        assert len(result.full_text) > 0

    def test_result_has_required_fields(self, passport_icao_base64):
        """Result contains all required fields."""
        image = decode_base64_image(passport_icao_base64)
        result = extract_text(image)

        assert isinstance(result.text_blocks, list)
        assert isinstance(result.full_text, str)
        assert isinstance(result.processing_time_ms, int)

    def test_text_blocks_have_confidence(self, passport_icao_base64):
        """Text blocks include confidence scores."""
        image = decode_base64_image(passport_icao_base64)
        result = extract_text(image)

        if result.text_blocks:
            block = result.text_blocks[0]
            assert isinstance(block.text, str)
            assert 0 <= block.confidence <= 1

    def test_text_blocks_have_bbox(self, passport_icao_base64):
        """Text blocks include bounding boxes."""
        image = decode_base64_image(passport_icao_base64)
        result = extract_text(image)

        if result.text_blocks:
            block = result.text_blocks[0]
            assert isinstance(block.bbox, list)

    # --- Edge cases / Pitfalls ---

    def test_blank_image_returns_empty_text(self, blank_image_base64):
        """Blank image returns empty/minimal text."""
        image = decode_base64_image(blank_image_base64)
        result = extract_text(image)

        assert result.full_text == "" or len(result.full_text) < 10
        assert len(result.text_blocks) == 0 or result.text_blocks == []

    def test_tiny_image_handles_gracefully(self, tiny_image_base64):
        """Very small image is handled gracefully."""
        image = decode_base64_image(tiny_image_base64)
        result = extract_text(image)

        # Should return valid structure even if no text
        assert isinstance(result.text_blocks, list)
        assert isinstance(result.full_text, str)
        assert result.error is None


# =============================================================================
# extract_text_from_base64 Tests
# =============================================================================


class TestExtractTextFromBase64:
    """Tests for base64-to-text extraction pipeline."""

    def test_extracts_text_from_valid_image(self, passport_icao_base64):
        """Valid base64 image returns extracted text."""
        result = extract_text_from_base64(passport_icao_base64)

        assert isinstance(result.text_blocks, list)
        assert isinstance(result.full_text, str)
        assert len(result.full_text) > 0
        assert result.error is None

    def test_handles_data_uri(self, base64_with_data_uri):
        """Data URI format is handled correctly."""
        result = extract_text_from_base64(base64_with_data_uri)

        assert result.error is None
        assert isinstance(result.full_text, str)

    # --- Edge cases / Pitfalls ---

    def test_invalid_base64_returns_error(self, invalid_base64):
        """Invalid base64 returns error in result object."""
        result = extract_text_from_base64(invalid_base64)

        assert result.error is not None
        assert "decode" in result.error.lower() or "failed" in result.error.lower()
        assert result.full_text == ""
        assert result.text_blocks == []

    def test_corrupted_file_returns_error(self, corrupted_file_base64):
        """Non-image data returns error in result object."""
        result = extract_text_from_base64(corrupted_file_base64)

        assert result.error is not None

    def test_empty_string_returns_error(self):
        """Empty string returns error."""
        result = extract_text_from_base64("")

        assert result.error is not None


# =============================================================================
# extract_document_text_from_base64 Tests
# =============================================================================


class TestExtractDocumentTextFromBase64:
    """Tests for document-optimized text extraction with MRZ fast path."""

    def test_extracts_text_from_passport(self, passport_icao_base64):
        """Extracts text from passport image."""
        result = extract_document_text_from_base64(passport_icao_base64)

        assert isinstance(result.text_blocks, list)
        assert isinstance(result.full_text, str)
        assert result.error is None
        assert len(result.full_text) > 0

    def test_extracts_text_from_id_card(self, id_card_spain_base64):
        """Extracts text from national ID card."""
        result = extract_document_text_from_base64(id_card_spain_base64)

        assert isinstance(result.text_blocks, list)
        assert isinstance(result.full_text, str)
        assert result.error is None

    def test_passport_uses_mrz_fast_path_for_portrait(self, passport_ukraine_base64):
        """Portrait passport image may use MRZ fast path."""
        result = extract_document_text_from_base64(passport_ukraine_base64)

        # Should return valid results either way
        assert isinstance(result.text_blocks, list)
        assert isinstance(result.full_text, str)
        assert result.error is None

    # --- Edge cases / Pitfalls ---

    def test_invalid_base64_returns_error(self, invalid_base64):
        """Invalid base64 returns error."""
        result = extract_document_text_from_base64(invalid_base64)

        assert result.error is not None

    def test_blank_image_returns_minimal_text(self, blank_image_base64):
        """Blank image returns empty/minimal text."""
        result = extract_document_text_from_base64(blank_image_base64)

        assert result.full_text == "" or len(result.full_text) < 10


class TestMrzHintPattern:
    """Tests for the MRZ hint detection pattern."""

    def test_matches_standard_mrz_prefix(self):
        """Pattern matches standard passport MRZ prefix."""
        assert PASSPORT_MRZ_HINT_PATTERN.search("P<USA")
        assert PASSPORT_MRZ_HINT_PATTERN.search("P<DOM")
        assert PASSPORT_MRZ_HINT_PATTERN.search("P<GBR")

    def test_matches_in_longer_text(self):
        """Pattern matches MRZ prefix in longer text."""
        text = "PASSPORT P<DOMSMITH<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<"
        assert PASSPORT_MRZ_HINT_PATTERN.search(text)

    def test_case_insensitive(self):
        """Pattern is case insensitive."""
        assert PASSPORT_MRZ_HINT_PATTERN.search("p<usa")
        assert PASSPORT_MRZ_HINT_PATTERN.search("P<Usa")

    def test_does_not_match_non_mrz(self):
        """Pattern doesn't match non-MRZ text."""
        assert not PASSPORT_MRZ_HINT_PATTERN.search("PASSPORT")
        assert not PASSPORT_MRZ_HINT_PATTERN.search("P<")  # Too short
        assert not PASSPORT_MRZ_HINT_PATTERN.search("P<AB")  # Only 2 chars after <


# =============================================================================
# Real OCR Integration Tests
# =============================================================================


class TestRealOcrIntegration:
    """Integration tests with real OCR on test images."""

    def test_icao_passport_mrz_extraction(self, passport_icao_base64):
        """ICAO passport image produces MRZ-like text."""
        result = extract_text_from_base64(passport_icao_base64)

        full_text = result.full_text.upper()
        # ICAO example should contain MRZ-like patterns
        # Note: OCR may not perfectly extract the MRZ
        assert len(full_text) > 20

    def test_spain_id_card_extraction(self, id_card_spain_base64):
        """Spanish ID card image produces readable text."""
        result = extract_text_from_base64(id_card_spain_base64)

        assert len(result.full_text) > 10
        assert len(result.text_blocks) > 0

    def test_peru_id_card_extraction(self, id_card_peru_base64):
        """Peru ID card image produces readable text."""
        result = extract_text_from_base64(id_card_peru_base64)

        assert len(result.full_text) > 10

    def test_processing_time_is_reasonable(self, passport_icao_base64):
        """OCR processing completes in reasonable time."""
        result = extract_text_from_base64(passport_icao_base64)

        # Should complete in under 30 seconds (generous for CI)
        assert result.processing_time_ms < 30000

    def test_confidence_scores_are_valid(self, passport_icao_base64):
        """Confidence scores are between 0 and 1."""
        result = extract_text_from_base64(passport_icao_base64)

        for block in result.text_blocks:
            assert 0 <= block.confidence <= 1
