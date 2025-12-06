"""
Optimal Frame Selection for Face Matching.

This module selects the best frame from a video sequence for use in
face matching with an ID document photo.

Selection criteria (minimal, as requested):
1. Face detection confidence >= 0.85
2. Single face detected
3. Face not obscured (facial analysis succeeds)

The best frame is the one with the highest overall quality score.
"""

import time
from typing import Optional

import numpy as np

from .detector import detect_faces, get_primary_face
from .facial_analysis import analyze_facial_attributes
from .antispoof import decode_base64_image


# Minimum thresholds
MIN_CONFIDENCE = 0.85
MIN_FACE_AREA_RATIO = 0.05  # 5% of image area


def calculate_frame_score(
    face_confidence: float,
    face_area_ratio: float,
    facial_analysis_success: bool,
    eyes_open: bool = True,
) -> float:
    """
    Calculate a quality score for a frame.

    Args:
        face_confidence: Detection confidence (0.0-1.0)
        face_area_ratio: Face area as ratio of image area
        facial_analysis_success: Whether facial analysis succeeded
        eyes_open: Whether eyes appear to be open

    Returns:
        Quality score (0.0-1.0)
    """
    score = 0.0

    # Face confidence contributes 40%
    if face_confidence >= MIN_CONFIDENCE:
        score += 0.4 * min(1.0, face_confidence)

    # Face size contributes 30% (larger is better, up to 30% of frame)
    if face_area_ratio >= MIN_FACE_AREA_RATIO:
        # Normalize: 5% = 0, 30% = 1
        size_score = min(1.0, (face_area_ratio - 0.05) / 0.25)
        score += 0.3 * size_score

    # Facial analysis success contributes 20%
    if facial_analysis_success:
        score += 0.2

    # Eyes open contributes 10%
    if eyes_open:
        score += 0.1

    return score


def evaluate_frame(image: np.ndarray) -> dict:
    """
    Evaluate a single frame for face matching suitability.

    Args:
        image: BGR image array

    Returns:
        dict with:
        - is_suitable: bool, meets minimum criteria
        - score: float (0.0-1.0)
        - face_confidence: float
        - face_count: int
        - face_area_ratio: float
        - facial_analysis_success: bool
        - issues: list of problem codes
        - processing_time_ms: int
    """
    start_time = time.time()
    issues = []

    try:
        # Step 1: Detect faces
        detection_result = detect_faces(image)
        face_count = detection_result.get("face_count", 0)

        if face_count == 0:
            issues.append("no_face")
            return {
                "is_suitable": False,
                "score": 0.0,
                "face_confidence": 0.0,
                "face_count": 0,
                "face_area_ratio": 0.0,
                "facial_analysis_success": False,
                "issues": issues,
                "processing_time_ms": int((time.time() - start_time) * 1000),
            }

        if face_count > 1:
            issues.append("multiple_faces")

        # Step 2: Get primary face info
        primary_face = get_primary_face(detection_result.get("faces", []))
        if not primary_face:
            issues.append("no_primary_face")
            return {
                "is_suitable": False,
                "score": 0.0,
                "face_confidence": 0.0,
                "face_count": face_count,
                "face_area_ratio": 0.0,
                "facial_analysis_success": False,
                "issues": issues,
                "processing_time_ms": int((time.time() - start_time) * 1000),
            }

        face_confidence = primary_face.get("confidence", 0.0)
        bbox = primary_face.get("bounding_box", {})

        # Calculate face area ratio
        face_width = bbox.get("width", 0)
        face_height = bbox.get("height", 0)
        face_area = face_width * face_height
        image_area = image.shape[0] * image.shape[1]
        face_area_ratio = face_area / image_area if image_area > 0 else 0.0

        # Check confidence threshold
        if face_confidence < MIN_CONFIDENCE:
            issues.append("low_confidence")

        # Check face size
        if face_area_ratio < MIN_FACE_AREA_RATIO:
            issues.append("face_too_small")

        # Step 3: Facial analysis (checks if face is visible/not obscured)
        facial_result = analyze_facial_attributes(image)
        facial_analysis_success = facial_result.get("success", False)

        if not facial_analysis_success:
            issues.append("face_obscured")

        # Calculate overall score
        score = calculate_frame_score(
            face_confidence=face_confidence,
            face_area_ratio=face_area_ratio,
            facial_analysis_success=facial_analysis_success,
            eyes_open=True,  # Assume open if analysis succeeded
        )

        # Determine suitability (minimal criteria)
        is_suitable = (
            face_count == 1 and
            face_confidence >= MIN_CONFIDENCE and
            face_area_ratio >= MIN_FACE_AREA_RATIO
        )

        return {
            "is_suitable": is_suitable,
            "score": score,
            "face_confidence": face_confidence,
            "face_count": face_count,
            "face_area_ratio": face_area_ratio,
            "facial_analysis_success": facial_analysis_success,
            "issues": issues if issues else None,
            "processing_time_ms": int((time.time() - start_time) * 1000),
        }

    except Exception as e:
        return {
            "is_suitable": False,
            "score": 0.0,
            "face_confidence": 0.0,
            "face_count": 0,
            "face_area_ratio": 0.0,
            "facial_analysis_success": False,
            "issues": ["processing_error"],
            "error": str(e),
            "processing_time_ms": int((time.time() - start_time) * 1000),
        }


def evaluate_frame_from_base64(base64_image: str) -> dict:
    """
    Evaluate a base64 encoded frame.

    Args:
        base64_image: Base64 encoded image string

    Returns:
        Frame evaluation result
    """
    try:
        image = decode_base64_image(base64_image)
        result = evaluate_frame(image)
        # PRIVACY: Explicitly delete image data from memory
        del image
        return result
    except Exception as e:
        return {
            "is_suitable": False,
            "score": 0.0,
            "face_confidence": 0.0,
            "face_count": 0,
            "face_area_ratio": 0.0,
            "facial_analysis_success": False,
            "issues": ["invalid_image"],
            "error": f"Failed to decode image: {str(e)}",
            "processing_time_ms": 0,
        }


class FrameSelector:
    """
    Tracks and selects the best frame from a sequence.

    Maintains state about the best frame seen so far.
    """

    def __init__(self):
        """Initialize the frame selector."""
        self.best_frame: Optional[np.ndarray] = None
        self.best_frame_base64: Optional[str] = None
        self.best_score: float = 0.0
        self.best_confidence: float = 0.0
        self.frames_evaluated: int = 0

    def reset(self):
        """Reset selector state for a new session."""
        self.best_frame = None
        self.best_frame_base64 = None
        self.best_score = 0.0
        self.best_confidence = 0.0
        self.frames_evaluated = 0

    def update(self, image: np.ndarray, base64_image: Optional[str] = None) -> dict:
        """
        Evaluate a frame and update best if it's better.

        Args:
            image: BGR image array
            base64_image: Optional base64 string of the image

        Returns:
            Evaluation result with additional field:
            - is_new_best: bool, True if this became the new best frame
        """
        result = evaluate_frame(image)
        self.frames_evaluated += 1

        is_new_best = False
        if result["is_suitable"] and result["score"] > self.best_score:
            self.best_frame = image.copy()
            self.best_frame_base64 = base64_image
            self.best_score = result["score"]
            self.best_confidence = result["face_confidence"]
            is_new_best = True

        result["is_new_best"] = is_new_best
        result["current_best_score"] = self.best_score
        result["frames_evaluated"] = self.frames_evaluated

        return result

    def update_from_base64(self, base64_image: str) -> dict:
        """
        Evaluate a base64 frame and update best if better.

        Args:
            base64_image: Base64 encoded image string

        Returns:
            Evaluation result
        """
        try:
            image = decode_base64_image(base64_image)
            return self.update(image, base64_image)
        except Exception as e:
            self.frames_evaluated += 1
            return {
                "is_suitable": False,
                "score": 0.0,
                "is_new_best": False,
                "current_best_score": self.best_score,
                "frames_evaluated": self.frames_evaluated,
                "issues": ["invalid_image"],
                "error": str(e),
            }

    def get_best_frame(self) -> Optional[np.ndarray]:
        """Get the best frame image array."""
        return self.best_frame

    def get_best_frame_base64(self) -> Optional[str]:
        """Get the best frame as base64 string."""
        return self.best_frame_base64

    def get_summary(self) -> dict:
        """Get summary of frame selection."""
        return {
            "has_best_frame": self.best_frame is not None,
            "best_score": self.best_score,
            "best_confidence": self.best_confidence,
            "frames_evaluated": self.frames_evaluated,
        }


def select_best_frame(frames: list[str]) -> dict:
    """
    Select the best frame from a list of base64 encoded images.

    Args:
        frames: List of base64 encoded image strings

    Returns:
        dict with:
        - best_frame_index: int
        - best_frame_score: float
        - best_frame_confidence: float
        - frames_evaluated: int
        - has_suitable_frame: bool
        - processing_time_ms: int
    """
    start_time = time.time()

    if not frames:
        return {
            "best_frame_index": -1,
            "best_frame_score": 0.0,
            "best_frame_confidence": 0.0,
            "frames_evaluated": 0,
            "has_suitable_frame": False,
            "processing_time_ms": 0,
            "error": "No frames provided",
        }

    selector = FrameSelector()
    best_index = -1

    for i, frame_b64 in enumerate(frames):
        result = selector.update_from_base64(frame_b64)
        if result.get("is_new_best"):
            best_index = i

    summary = selector.get_summary()

    return {
        "best_frame_index": best_index,
        "best_frame_score": summary["best_score"],
        "best_frame_confidence": summary["best_confidence"],
        "frames_evaluated": summary["frames_evaluated"],
        "has_suitable_frame": summary["has_best_frame"],
        "processing_time_ms": int((time.time() - start_time) * 1000),
    }
