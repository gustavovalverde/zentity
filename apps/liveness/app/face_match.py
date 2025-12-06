"""
Face Matching Module - Privacy-Preserving Face Verification

Compares face embeddings between ID photo and selfie to verify identity.
IMPORTANT: All face embeddings are processed transiently and NEVER stored.

Privacy Design:
- Face embeddings are extracted, compared, and immediately discarded
- Only a boolean match result is returned
- No biometric templates are persisted

Uses DeepFace's verification with configurable models and backends.
"""

import base64
import time
from typing import Optional, Tuple

import cv2
import numpy as np

from .antispoof import decode_base64_image
from .detector import detect_faces, get_primary_face


def encode_image_to_base64(image: np.ndarray) -> str:
    """Encode a numpy image array to base64 string with data URL prefix."""
    # Ensure image is in BGR for cv2.imencode
    if len(image.shape) == 3 and image.shape[2] == 3:
        # Convert RGB to BGR if needed (assume input is RGB from decode_base64_image)
        image_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    else:
        image_bgr = image

    _, buffer = cv2.imencode('.jpg', image_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
    b64_string = base64.b64encode(buffer).decode('utf-8')
    return f"data:image/jpeg;base64,{b64_string}"


def crop_face_from_image(
    image: np.ndarray,
    padding_ratio: float = 0.3,
    detector_backend: str = "retinaface",
) -> Tuple[Optional[np.ndarray], Optional[str]]:
    """
    Detect and crop the primary face from an image.

    Useful for ID documents where the face is a small portion of the image.
    Adding padding around the face helps improve recognition accuracy.

    Args:
        image: numpy array of the image (RGB or BGR)
        padding_ratio: extra padding around face as ratio of face size (0.3 = 30%)
        detector_backend: face detection backend

    Returns:
        Tuple of (cropped face image, error message or None)
    """
    try:
        # Detect faces in the image
        detection_result = detect_faces(image, detector_backend)

        if detection_result.get("error"):
            return None, detection_result["error"]

        if detection_result["face_count"] == 0:
            return None, "No face detected in image"

        # Get the primary (largest) face
        primary_face = get_primary_face(detection_result["faces"])
        if not primary_face:
            return None, "Could not identify primary face"

        # Extract bounding box
        bb = primary_face["bounding_box"]
        x, y = bb["x"], bb["y"]
        w, h = bb["width"], bb["height"]

        # Add padding around the face
        pad_w = int(w * padding_ratio)
        pad_h = int(h * padding_ratio)

        # Calculate padded coordinates (clamp to image bounds)
        img_h, img_w = image.shape[:2]
        x1 = max(0, x - pad_w)
        y1 = max(0, y - pad_h)
        x2 = min(img_w, x + w + pad_w)
        y2 = min(img_h, y + h + pad_h)

        # Crop the face region
        cropped_face = image[y1:y2, x1:x2]

        if cropped_face.size == 0:
            return None, "Failed to crop face region"

        return cropped_face, None

    except Exception as e:
        return None, f"Face cropping failed: {str(e)}"


def extract_face_embedding(
    image: np.ndarray,
    model_name: str = "ArcFace",
    detector_backend: str = "retinaface",
) -> Tuple[Optional[np.ndarray], Optional[str]]:
    """
    Extract face embedding from an image.

    Args:
        image: numpy array of the image in RGB format
        model_name: Face recognition model (ArcFace, Facenet512, VGG-Face, etc.)
        detector_backend: Face detection backend

    Returns:
        Tuple of (embedding array, error message or None)
    """
    from deepface import DeepFace

    try:
        # Extract face representation (embedding)
        result = DeepFace.represent(
            img_path=image,
            model_name=model_name,
            detector_backend=detector_backend,
            enforce_detection=True,
        )

        if not result or len(result) == 0:
            return None, "No face detected"

        # Get the embedding from the first (primary) face
        embedding = np.array(result[0].get("embedding", []))

        if embedding.size == 0:
            return None, "Failed to extract face embedding"

        return embedding, None

    except ValueError as e:
        if "Face could not be detected" in str(e):
            return None, "No face detected in image"
        return None, str(e)
    except Exception as e:
        return None, str(e)


def compare_faces(
    id_image: np.ndarray,
    selfie_image: np.ndarray,
    model_name: str = "ArcFace",
    detector_backend: str = "retinaface",
    distance_metric: str = "cosine",
    threshold: Optional[float] = None,
) -> dict:
    """
    Compare faces between ID photo and selfie.

    This is the core face matching function. It:
    1. Extracts embeddings from both images (transient)
    2. Computes similarity distance
    3. Returns match result
    4. DISCARDS all embeddings (never stored)

    Args:
        id_image: Image from ID document (numpy array)
        selfie_image: Selfie image (numpy array)
        model_name: Face recognition model
        detector_backend: Face detection backend
        distance_metric: Distance metric (cosine, euclidean, euclidean_l2)
        threshold: Custom matching threshold (uses model default if None)

    Returns:
        dict with keys:
        - matched: bool - whether faces match
        - distance: float - similarity distance (lower = more similar)
        - threshold: float - threshold used for matching
        - confidence: float - match confidence (1 - distance/threshold)
        - processing_time_ms: int
        - error: optional error message
    """
    from deepface import DeepFace

    start_time = time.time()

    try:
        # Use DeepFace.verify for face comparison
        result = DeepFace.verify(
            img1_path=id_image,
            img2_path=selfie_image,
            model_name=model_name,
            detector_backend=detector_backend,
            distance_metric=distance_metric,
            enforce_detection=True,
        )

        processing_time_ms = int((time.time() - start_time) * 1000)

        # Extract results
        verified = result.get("verified", False)
        distance = result.get("distance", 1.0)
        used_threshold = result.get("threshold", threshold or 0.4)

        # Calculate confidence: how far below threshold (max 1.0)
        # If distance is 0, confidence is 1.0
        # If distance >= threshold, confidence is 0.0
        confidence = max(0.0, min(1.0, 1.0 - (distance / used_threshold)))

        return {
            "matched": verified,
            "distance": round(distance, 4),
            "threshold": used_threshold,
            "confidence": round(confidence, 4),
            "model": model_name,
            "processing_time_ms": processing_time_ms,
        }

    except ValueError as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        # Provide clearer error messages
        if "Face could not be detected" in error_msg:
            return {
                "matched": False,
                "distance": 1.0,
                "threshold": threshold or 0.4,
                "confidence": 0.0,
                "processing_time_ms": processing_time_ms,
                "error": "Face not detected in one or both images",
            }

        return {
            "matched": False,
            "distance": 1.0,
            "threshold": threshold or 0.4,
            "confidence": 0.0,
            "processing_time_ms": processing_time_ms,
            "error": error_msg,
        }

    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "matched": False,
            "distance": 1.0,
            "threshold": threshold or 0.4,
            "confidence": 0.0,
            "processing_time_ms": processing_time_ms,
            "error": str(e),
        }


def compare_faces_from_base64(
    id_image_base64: str,
    selfie_image_base64: str,
    model_name: str = "ArcFace",
    detector_backend: str = "retinaface",
    distance_metric: str = "cosine",
    threshold: Optional[float] = None,
    extract_id_face: bool = True,
) -> dict:
    """
    Compare faces from base64 encoded images.

    Privacy-preserving face matching endpoint. All data is processed
    transiently and discarded after comparison.

    For ID documents, the face is first extracted/cropped from the document
    to improve matching accuracy (documents contain borders, text, etc.).

    Args:
        id_image_base64: Base64 encoded ID document image
        selfie_image_base64: Base64 encoded selfie image
        model_name: Face recognition model
        detector_backend: Face detection backend
        distance_metric: Distance metric
        threshold: Custom matching threshold
        extract_id_face: If True, crop face from ID before comparison (default: True)

    Returns:
        dict with face matching results
    """
    start_time = time.time()
    id_face_extracted = False
    cropped_id_face_b64 = None

    try:
        # Decode images (transient - held in memory only)
        id_image = decode_base64_image(id_image_base64)
        selfie_image = decode_base64_image(selfie_image_base64)

        # Extract face from ID document for better matching
        # ID documents have borders, text, holograms that interfere with matching
        if extract_id_face:
            cropped_id_face, crop_error = crop_face_from_image(
                id_image,
                padding_ratio=0.3,
                detector_backend=detector_backend,
            )
            if cropped_id_face is not None:
                # Encode the cropped face for UI display
                cropped_id_face_b64 = encode_image_to_base64(cropped_id_face)
                id_image = cropped_id_face
                id_face_extracted = True
            # If cropping fails, fall back to full image
            # DeepFace may still detect the face

        # Compare faces
        result = compare_faces(
            id_image=id_image,
            selfie_image=selfie_image,
            model_name=model_name,
            detector_backend=detector_backend,
            distance_metric=distance_metric,
            threshold=threshold,
        )

        # Add flag indicating if ID face was extracted
        result["id_face_extracted"] = id_face_extracted
        # Include the cropped face image for UI display
        if cropped_id_face_b64:
            result["id_face_image"] = cropped_id_face_b64

        # PRIVACY: Explicitly delete sensitive image data from memory
        # Don't rely solely on garbage collection for biometric data
        del id_image
        del selfie_image

        return result

    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "matched": False,
            "distance": 1.0,
            "threshold": threshold or 0.4,
            "confidence": 0.0,
            "processing_time_ms": processing_time_ms,
            "error": f"Failed to decode images: {str(e)}",
        }


def verify_identity_match(
    id_image_base64: str,
    selfie_image_base64: str,
    min_confidence: float = 0.6,
) -> dict:
    """
    High-level identity verification combining face matching with liveness.

    This is the recommended endpoint for full identity verification.
    It uses sensible defaults and returns a simple pass/fail result.

    Args:
        id_image_base64: Base64 encoded ID document image
        selfie_image_base64: Base64 encoded selfie image
        min_confidence: Minimum confidence required for match (0.0-1.0)

    Returns:
        dict with:
        - is_match: bool - whether identity is verified
        - confidence: float - match confidence
        - processing_time_ms: int
        - error: optional error message
    """
    result = compare_faces_from_base64(
        id_image_base64=id_image_base64,
        selfie_image_base64=selfie_image_base64,
        model_name="ArcFace",  # Best accuracy for ID verification
        detector_backend="retinaface",  # Best face detection
        distance_metric="cosine",
    )

    # Return simplified result
    is_match = result.get("matched", False) and result.get("confidence", 0.0) >= min_confidence

    return {
        "is_match": is_match,
        "confidence": result.get("confidence", 0.0),
        "processing_time_ms": result.get("processing_time_ms", 0),
        "error": result.get("error"),
    }
