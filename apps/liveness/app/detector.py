"""
Face detection module.

Uses DeepFace's built-in face detection (with RetinaFace backend)
for detecting faces in images. This can be extended to use UniFace
for 106-point landmarks when gesture-based challenges are needed.
"""

import time
from typing import List, Optional

import numpy as np

from .antispoof import decode_base64_image


def detect_faces(
    image: np.ndarray,
    detector_backend: str = "retinaface"
) -> dict:
    """
    Detect faces in an image using DeepFace.

    Args:
        image: numpy array of the image in RGB format
        detector_backend: detection backend to use (default: retinaface)

    Returns:
        dict with keys:
        - face_count: number of faces detected
        - faces: list of face data with bounding boxes
        - processing_time_ms: detection time
        - error: optional error message
    """
    from deepface import DeepFace

    start_time = time.time()

    try:
        # Use extract_faces for detection
        result = DeepFace.extract_faces(
            img_path=image,
            detector_backend=detector_backend,
            anti_spoofing=False,  # Just detection, no anti-spoofing
            enforce_detection=False
        )

        processing_time_ms = int((time.time() - start_time) * 1000)

        if not result:
            return {
                "face_count": 0,
                "faces": [],
                "processing_time_ms": processing_time_ms
            }

        faces = []
        for face in result:
            facial_area = face.get("facial_area", {})
            width = facial_area.get("w", 0)
            height = facial_area.get("h", 0)
            confidence = face.get("confidence", 0.0)

            # Filter out invalid faces (no bounding box or zero confidence)
            # This happens when enforce_detection=False and no face is found
            if width <= 0 or height <= 0 or confidence <= 0:
                continue

            faces.append({
                "bounding_box": {
                    "x": facial_area.get("x", 0),
                    "y": facial_area.get("y", 0),
                    "width": width,
                    "height": height
                },
                "confidence": confidence
            })

        return {
            "face_count": len(faces),
            "faces": faces,
            "processing_time_ms": processing_time_ms
        }

    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        return {
            "face_count": 0,
            "faces": [],
            "processing_time_ms": processing_time_ms,
            "error": str(e)
        }


def detect_faces_from_base64(
    base64_image: str,
    detector_backend: str = "retinaface"
) -> dict:
    """
    Detect faces from a base64 encoded image.

    Args:
        base64_image: Base64 encoded image string
        detector_backend: detection backend to use

    Returns:
        dict with face detection results
    """
    try:
        image = decode_base64_image(base64_image)
        return detect_faces(image, detector_backend)
    except Exception as e:
        return {
            "face_count": 0,
            "faces": [],
            "processing_time_ms": 0,
            "error": f"Failed to decode image: {str(e)}"
        }


def get_primary_face(faces: List[dict]) -> Optional[dict]:
    """
    Get the primary (largest) face from a list of detected faces.

    Args:
        faces: list of face detection results

    Returns:
        The face with the largest bounding box area, or None if empty
    """
    if not faces:
        return None

    def face_area(face: dict) -> int:
        bb = face.get("bounding_box", {})
        return bb.get("width", 0) * bb.get("height", 0)

    return max(faces, key=face_area)
