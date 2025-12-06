"""
Combined liveness detection module.

This module provides a unified interface for liveness detection,
combining face detection with facial attribute analysis.

Phase 1 approach (facial attribute liveness):
- Face detection using RetinaFace
- Facial attribute analysis using DeepFace (emotion detection)
- Face quality validation (confidence, size)
- Interactive challenges (smile detection)

Phase 2 (future):
- Single frame anti-spoofing using DeepFace FasNet
"""

import time
from typing import Optional

import numpy as np

from .antispoof import decode_base64_image, check_antispoof
from .detector import detect_faces, get_primary_face
from .facial_analysis import analyze_facial_attributes, check_face_visibility


def validate_face_quality(face: dict, image_shape: tuple) -> list:
    """
    Validate that detected face meets quality requirements.

    Args:
        face: dict with face detection result (confidence, bounding_box)
        image_shape: tuple of image dimensions (height, width, channels)

    Returns:
        list of issue codes found (empty if face passes quality checks)
    """
    issues = []

    if not face:
        return ["no_face_data"]

    # Check detection confidence (minimum 0.85)
    confidence = face.get("confidence", 0.0)
    if confidence < 0.85:
        issues.append("low_face_confidence")

    # Check face size relative to image (at least 10% of image area)
    bb = face.get("bounding_box", {})
    face_width = bb.get("width", 0)
    face_height = bb.get("height", 0)
    face_area = face_width * face_height

    if len(image_shape) >= 2:
        image_height, image_width = image_shape[:2]
        image_area = image_height * image_width
        if image_area > 0 and face_area < image_area * 0.05:
            issues.append("face_too_small")

    return issues


def check_liveness(
    image: np.ndarray,
    antispoof_threshold: float = 0.3,
    require_facial_analysis: bool = True,
    enable_antispoof: bool = False  # Phase 2: Enable when ready
) -> dict:
    """
    Perform full liveness check on an image.

    Phase 1: Uses facial attribute analysis to verify face visibility.
    If facial analysis succeeds, the face is clearly visible (not obscured).

    Phase 2 (future): Adds anti-spoofing check for presentation attack detection.

    Args:
        image: numpy array of the image in RGB format
        antispoof_threshold: minimum score to consider as real (Phase 2)
        require_facial_analysis: whether to require facial attribute analysis
        enable_antispoof: whether to enable FasNet anti-spoofing (Phase 2)

    Returns:
        dict with keys:
        - is_real: bool indicating liveness check passed
        - antispoof_score: float from 0.0 to 1.0
        - face_count: number of faces detected
        - bounding_box: primary face bounding box (if detected)
        - processing_time_ms: total processing time
        - issues: list of detected issues (if any)
        - facial_analysis: facial attribute data (if enabled)
        - error: error message (if failed)
    """
    start_time = time.time()
    issues = []
    facial_analysis = None

    try:
        # Step 1: Detect faces
        detection_result = detect_faces(image)
        face_count = detection_result.get("face_count", 0)

        if face_count == 0:
            issues.append("no_face")
            return {
                "is_real": False,
                "antispoof_score": 0.0,
                "face_count": 0,
                "bounding_box": None,
                "processing_time_ms": int((time.time() - start_time) * 1000),
                "issues": issues,
                "facial_analysis": None
            }

        if face_count > 1:
            issues.append("multiple_faces")
            # Continue with check but flag the issue

        # Get primary face
        primary_face = get_primary_face(detection_result.get("faces", []))
        bounding_box = primary_face.get("bounding_box") if primary_face else None

        # Step 2: Validate face quality
        quality_issues = validate_face_quality(primary_face, image.shape)
        issues.extend(quality_issues)

        # Step 3: Facial attribute analysis (Phase 1 - primary liveness check)
        # If face can be analyzed for emotions, it's clearly visible (not obscured)
        if require_facial_analysis:
            facial_analysis = analyze_facial_attributes(image)
            if not facial_analysis.get("success"):
                issues.append("face_obscured")

        # Step 4: Anti-spoofing check (Phase 2 - disabled by default)
        antispoof_score = 1.0  # Default to passing
        if enable_antispoof:
            antispoof_result = check_antispoof(image, antispoof_threshold)
            is_spoof_check_real = antispoof_result.get("is_real", False)
            antispoof_score = antispoof_result.get("antispoof_score", 0.0)
            if not is_spoof_check_real:
                issues.append("spoof_detected")

        processing_time_ms = int((time.time() - start_time) * 1000)

        # Determine if passed: single face, no issues, facial analysis success
        is_real = (
            face_count == 1 and
            len(issues) == 0 and
            (not require_facial_analysis or facial_analysis.get("success", False))
        )

        return {
            "is_real": is_real,
            "antispoof_score": antispoof_score,
            "face_count": face_count,
            "bounding_box": bounding_box,
            "processing_time_ms": processing_time_ms,
            "issues": issues if issues else None,
            "facial_analysis": facial_analysis
        }

    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "is_real": False,
            "antispoof_score": 0.0,
            "face_count": 0,
            "bounding_box": None,
            "processing_time_ms": processing_time_ms,
            "issues": ["processing_error"],
            "facial_analysis": None,
            "error": str(e)
        }


def check_liveness_from_base64(
    base64_image: str,
    antispoof_threshold: float = 0.3,
    require_facial_analysis: bool = True,
    enable_antispoof: bool = False
) -> dict:
    """
    Perform liveness check from a base64 encoded image.

    Args:
        base64_image: Base64 encoded image string
        antispoof_threshold: minimum score to consider as real (Phase 2)
        require_facial_analysis: whether to require facial attribute analysis
        enable_antispoof: whether to enable FasNet anti-spoofing (Phase 2)

    Returns:
        dict with liveness check results
    """
    try:
        image = decode_base64_image(base64_image)
        result = check_liveness(
            image,
            antispoof_threshold=antispoof_threshold,
            require_facial_analysis=require_facial_analysis,
            enable_antispoof=enable_antispoof
        )
        # PRIVACY: Explicitly delete image data from memory
        del image
        return result
    except Exception as e:
        return {
            "is_real": False,
            "antispoof_score": 0.0,
            "face_count": 0,
            "bounding_box": None,
            "processing_time_ms": 0,
            "issues": ["invalid_image"],
            "facial_analysis": None,
            "error": f"Failed to decode image: {str(e)}"
        }


def validate_selfie(base64_image: str) -> dict:
    """
    Validate a selfie image for KYC purposes.

    This is a convenience function that performs liveness check
    and returns a simplified validation result.

    Args:
        base64_image: Base64 encoded selfie image

    Returns:
        dict with keys:
        - is_valid: bool indicating if selfie passes validation
        - issues: list of issues found (empty if valid)
        - liveness_result: full liveness check result
    """
    result = check_liveness_from_base64(base64_image)

    is_valid = (
        result.get("is_real", False) and
        result.get("face_count", 0) == 1 and
        not result.get("issues")
    )

    return {
        "is_valid": is_valid,
        "issues": result.get("issues", []) or [],
        "liveness_result": result
    }
