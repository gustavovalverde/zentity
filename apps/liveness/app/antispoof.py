"""
Anti-spoofing module using DeepFace FasNet.

This module wraps DeepFace's built-in anti-spoofing functionality
to detect presentation attacks (photos, screens, masks).
"""

import base64
import io
import time
from typing import Optional

import numpy as np
from PIL import Image


def decode_base64_image(base64_string: str) -> np.ndarray:
    """
    Decode a base64 image string to numpy array.

    Args:
        base64_string: Base64 encoded image (with or without data URL prefix)

    Returns:
        numpy array of the image in RGB format
    """
    # Remove data URL prefix if present
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]

    # Decode base64 to bytes
    image_bytes = base64.b64decode(base64_string)

    # Open image with PIL and convert to RGB
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Convert to numpy array
    return np.array(image)


def check_antispoof(
    image: np.ndarray,
    threshold: float = 0.3
) -> dict:
    """
    Check if an image is real (not spoofed) using DeepFace.

    Uses DeepFace's built-in FasNet anti-spoofing model to detect
    presentation attacks such as:
    - Printed photos
    - Screen displays (replay attacks)
    - 2D masks

    Args:
        image: numpy array of the image in RGB format
        threshold: minimum antispoof_score to consider as real (default: 0.3)
                   Note: Webcam images often score lower due to compression

    Returns:
        dict with keys:
        - is_real: bool indicating if the image appears to be a real face
        - antispoof_score: float from 0.0 to 1.0 (higher = more likely real)
        - processing_time_ms: time taken for anti-spoofing check
        - error: optional error message if detection failed
    """
    from deepface import DeepFace

    start_time = time.time()

    try:
        # DeepFace expects BGR format, but can also handle RGB
        # Use extract_faces with anti_spoofing=True
        result = DeepFace.extract_faces(
            img_path=image,
            detector_backend="retinaface",  # Best accuracy
            anti_spoofing=True,
            enforce_detection=False  # Don't raise error if no face
        )

        processing_time_ms = int((time.time() - start_time) * 1000)

        if not result:
            print(f"[ANTISPOOF] No face detected in image")
            return {
                "is_real": False,
                "antispoof_score": 0.0,
                "processing_time_ms": processing_time_ms,
                "error": "no_face_detected"
            }

        # Get the first face result
        face = result[0]

        # Extract anti-spoofing results
        deepface_is_real = face.get("is_real", False)
        antispoof_score = face.get("antispoof_score", 0.0)
        confidence = face.get("confidence", 0.0)

        # Debug logging
        print(f"[ANTISPOOF] DeepFace is_real: {deepface_is_real}")
        print(f"[ANTISPOOF] antispoof_score: {antispoof_score:.4f}")
        print(f"[ANTISPOOF] face_confidence: {confidence:.4f}")
        print(f"[ANTISPOOF] threshold: {threshold}")

        # Apply threshold - use score-based check since DeepFace's is_real
        # can be too strict for webcam captures
        final_is_real = antispoof_score >= threshold

        print(f"[ANTISPOOF] final_is_real (score >= threshold): {final_is_real}")

        return {
            "is_real": final_is_real,
            "antispoof_score": float(antispoof_score),
            "processing_time_ms": processing_time_ms,
            "face_confidence": confidence,
            "facial_area": face.get("facial_area", None),
            "deepface_is_real": deepface_is_real  # Include original DeepFace result
        }

    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "is_real": False,
            "antispoof_score": 0.0,
            "processing_time_ms": processing_time_ms,
            "error": str(e)
        }


def check_antispoof_from_base64(
    base64_image: str,
    threshold: float = 0.5
) -> dict:
    """
    Convenience function to check anti-spoofing from base64 image.

    Args:
        base64_image: Base64 encoded image string
        threshold: minimum antispoof_score to consider as real

    Returns:
        dict with anti-spoofing results
    """
    try:
        image = decode_base64_image(base64_image)
        result = check_antispoof(image, threshold)
        # PRIVACY: Explicitly delete image data from memory
        del image
        return result
    except Exception as e:
        return {
            "is_real": False,
            "antispoof_score": 0.0,
            "processing_time_ms": 0,
            "error": f"Failed to decode image: {str(e)}"
        }
