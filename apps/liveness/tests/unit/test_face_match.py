"""
Unit tests for the face matching module.

Tests the privacy-preserving face comparison:
- Face matching between ID photo and selfie
- Error handling for missing faces
- Confidence calculation

All tests mock DeepFace to avoid requiring actual ML models.
"""
import pytest
from unittest.mock import patch, MagicMock
import sys
import numpy as np

# Create a mock deepface module before any imports
mock_deepface_module = MagicMock()
sys.modules['deepface'] = mock_deepface_module


class TestCompareFaces:
    """Tests for the compare_faces function."""

    def test_matching_faces_returns_true(self, sample_image_array):
        """Verify that matching faces return verified=True."""
        mock_deepface_module.DeepFace.verify.return_value = {
            'verified': True,
            'distance': 0.2,
            'threshold': 0.4,
        }

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
        )

        assert result['matched'] is True
        assert result['distance'] == 0.2
        assert result['confidence'] >= 0.5

    def test_different_faces_returns_false(self, sample_image_array):
        """Verify that different faces return verified=False."""
        mock_deepface_module.DeepFace.verify.return_value = {
            'verified': False,
            'distance': 0.8,
            'threshold': 0.4,
        }

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
        )

        assert result['matched'] is False
        assert result['distance'] == 0.8

    def test_no_face_detected_returns_error(self, sample_image_array):
        """Verify that missing face detection returns error."""
        mock_deepface_module.DeepFace.verify.side_effect = ValueError("Face could not be detected")

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
        )

        assert result['matched'] is False
        assert 'error' in result
        assert 'not detected' in result['error']

        # Reset side_effect
        mock_deepface_module.DeepFace.verify.side_effect = None

    def test_confidence_calculation_at_threshold(self, sample_image_array):
        """Verify confidence is 0 when distance equals threshold."""
        mock_deepface_module.DeepFace.verify.return_value = {
            'verified': False,
            'distance': 0.4,
            'threshold': 0.4,
        }

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
        )

        assert result['confidence'] == 0.0

    def test_confidence_calculation_perfect_match(self, sample_image_array):
        """Verify confidence is 1.0 when distance is 0."""
        mock_deepface_module.DeepFace.verify.return_value = {
            'verified': True,
            'distance': 0.0,
            'threshold': 0.4,
        }

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
        )

        assert result['confidence'] == 1.0

    def test_confidence_calculation_half_threshold(self, sample_image_array):
        """Verify confidence is 0.5 when distance is half the threshold."""
        mock_deepface_module.DeepFace.verify.return_value = {
            'verified': True,
            'distance': 0.2,
            'threshold': 0.4,
        }

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
        )

        assert result['confidence'] == 0.5

    def test_includes_processing_time(self, sample_image_array):
        """Verify that processing time is included in result."""
        mock_deepface_module.DeepFace.verify.return_value = {
            'verified': True,
            'distance': 0.2,
            'threshold': 0.4,
        }

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
        )

        assert 'processing_time_ms' in result
        assert isinstance(result['processing_time_ms'], int)
        assert result['processing_time_ms'] >= 0

    def test_custom_threshold(self, sample_image_array):
        """Verify custom threshold is used."""
        mock_deepface_module.DeepFace.verify.return_value = {
            'verified': True,
            'distance': 0.3,
            'threshold': 0.5,
        }

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
            threshold=0.5,
        )

        assert result['threshold'] == 0.5

    def test_generic_exception_handling(self, sample_image_array):
        """Verify generic exceptions are handled gracefully."""
        mock_deepface_module.DeepFace.verify.side_effect = Exception("Unknown error")

        from app.face_match import compare_faces

        result = compare_faces(
            id_image=sample_image_array,
            selfie_image=sample_image_array,
        )

        assert result['matched'] is False
        assert 'error' in result
        assert 'Unknown error' in result['error']

        # Reset side_effect
        mock_deepface_module.DeepFace.verify.side_effect = None


class TestExtractFaceEmbedding:
    """Tests for face embedding extraction."""

    def test_successful_embedding_extraction(self, sample_image_array):
        """Verify successful embedding extraction."""
        mock_embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
        mock_deepface_module.DeepFace.represent.return_value = [
            {'embedding': mock_embedding}
        ]

        from app.face_match import extract_face_embedding

        embedding, error = extract_face_embedding(sample_image_array)

        assert embedding is not None
        assert error is None
        assert len(embedding) == 5

    def test_no_face_returns_error(self, sample_image_array):
        """Verify error when no face detected."""
        mock_deepface_module.DeepFace.represent.return_value = []

        from app.face_match import extract_face_embedding

        embedding, error = extract_face_embedding(sample_image_array)

        assert embedding is None
        assert error is not None
        assert 'No face' in error

    def test_exception_returns_error(self, sample_image_array):
        """Verify exception handling."""
        mock_deepface_module.DeepFace.represent.side_effect = ValueError("Face could not be detected")

        from app.face_match import extract_face_embedding

        embedding, error = extract_face_embedding(sample_image_array)

        assert embedding is None
        assert error is not None

        # Reset side_effect
        mock_deepface_module.DeepFace.represent.side_effect = None


class TestVerifyIdentityMatch:
    """Tests for the high-level identity verification function."""

    @patch('app.face_match.compare_faces_from_base64')
    def test_high_confidence_match(self, mock_compare, sample_base64_image):
        """Verify high confidence returns is_match=True."""
        mock_compare.return_value = {
            'matched': True,
            'confidence': 0.8,
            'processing_time_ms': 100,
        }

        from app.face_match import verify_identity_match

        result = verify_identity_match(
            id_image_base64=sample_base64_image,
            selfie_image_base64=sample_base64_image,
            min_confidence=0.6,
        )

        assert result['is_match'] is True
        assert result['confidence'] == 0.8

    @patch('app.face_match.compare_faces_from_base64')
    def test_low_confidence_no_match(self, mock_compare, sample_base64_image):
        """Verify low confidence returns is_match=False."""
        mock_compare.return_value = {
            'matched': True,
            'confidence': 0.4,
            'processing_time_ms': 100,
        }

        from app.face_match import verify_identity_match

        result = verify_identity_match(
            id_image_base64=sample_base64_image,
            selfie_image_base64=sample_base64_image,
            min_confidence=0.6,
        )

        assert result['is_match'] is False
        assert result['confidence'] == 0.4

    @patch('app.face_match.compare_faces_from_base64')
    def test_face_mismatch_returns_false(self, mock_compare, sample_base64_image):
        """Verify face mismatch returns is_match=False."""
        mock_compare.return_value = {
            'matched': False,
            'confidence': 0.2,
            'processing_time_ms': 100,
        }

        from app.face_match import verify_identity_match

        result = verify_identity_match(
            id_image_base64=sample_base64_image,
            selfie_image_base64=sample_base64_image,
        )

        assert result['is_match'] is False


class TestCompareFacesFromBase64:
    """Tests for base64 image handling."""

    @patch('app.face_match.compare_faces')
    @patch('app.face_match.decode_base64_image')
    def test_decodes_and_compares(self, mock_decode, mock_compare, sample_base64_image):
        """Verify images are decoded before comparison."""
        mock_decode.return_value = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_compare.return_value = {
            'matched': True,
            'distance': 0.2,
            'threshold': 0.4,
            'confidence': 0.5,
            'processing_time_ms': 100,
        }

        from app.face_match import compare_faces_from_base64

        result = compare_faces_from_base64(
            id_image_base64=sample_base64_image,
            selfie_image_base64=sample_base64_image,
        )

        assert mock_decode.call_count == 2
        assert result['matched'] is True

    @patch('app.face_match.decode_base64_image')
    def test_invalid_base64_returns_error(self, mock_decode):
        """Verify invalid base64 handling."""
        mock_decode.side_effect = Exception("Invalid base64")

        from app.face_match import compare_faces_from_base64

        result = compare_faces_from_base64(
            id_image_base64="invalid",
            selfie_image_base64="invalid",
        )

        assert result['matched'] is False
        assert 'error' in result
        assert 'Failed to decode' in result['error']
