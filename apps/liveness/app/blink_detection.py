"""
Blink Detection Module using UniFace 106-point Landmarks.

This module provides blink detection for passive liveness verification
using the Eye Aspect Ratio (EAR) algorithm.

EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)

When EAR drops below threshold, the eye is considered closed.
A blink is detected when EAR drops and then rises again.

106-point landmark eye indices (standard InsightFace ordering):
- Right eye: indices 33-42 (10 points around the eye)
- Left eye: indices 87-96 (10 points around the eye)

For EAR calculation we use 6 key points per eye:
- p1: outer corner, p4: inner corner (horizontal)
- p2, p3: upper eyelid, p5, p6: lower eyelid (vertical)
"""

import time
from typing import Optional, Tuple

import numpy as np
from uniface import Landmark106, RetinaFace

from .antispoof import decode_base64_image

# EAR thresholds
EAR_BLINK_THRESHOLD = 0.21  # Below this = eye closed
EAR_OPEN_THRESHOLD = 0.25   # Above this = eye open
CONSECUTIVE_FRAMES_FOR_BLINK = 2  # Frames eye must be closed to count as blink

# 106-point landmark indices for eyes (InsightFace ordering)
# Right eye: 6 key points for EAR calculation
RIGHT_EYE_INDICES = [33, 34, 35, 36, 37, 38]  # outer, upper1, upper2, inner, lower1, lower2
# Left eye: 6 key points for EAR calculation
LEFT_EYE_INDICES = [87, 88, 89, 90, 91, 92]   # inner, upper1, upper2, outer, lower1, lower2


def calculate_ear(eye_landmarks: np.ndarray) -> float:
    """
    Calculate Eye Aspect Ratio for a single eye.

    Uses 6 key landmarks:
    - p1 (0): outer corner
    - p2 (1): upper eyelid point 1
    - p3 (2): upper eyelid point 2
    - p4 (3): inner corner
    - p5 (4): lower eyelid point 1
    - p6 (5): lower eyelid point 2

    EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)

    Args:
        eye_landmarks: Array of shape (6, 2) with eye landmark coordinates

    Returns:
        Eye Aspect Ratio (0.0 to ~0.4 typical range)
    """
    if len(eye_landmarks) < 6:
        return 0.0

    # Vertical distances (upper to lower eyelid)
    v1 = np.linalg.norm(eye_landmarks[1] - eye_landmarks[5])  # p2 - p6
    v2 = np.linalg.norm(eye_landmarks[2] - eye_landmarks[4])  # p3 - p5

    # Horizontal distance (outer to inner corner)
    h = np.linalg.norm(eye_landmarks[0] - eye_landmarks[3])   # p1 - p4

    if h == 0:
        return 0.0

    ear = (v1 + v2) / (2.0 * h)
    return float(ear)


class BlinkDetector:
    """
    Stateful blink detector using UniFace 106-point landmarks.

    Tracks blinks across multiple frames using Eye Aspect Ratio.
    A blink is counted when:
    1. EAR drops below BLINK_THRESHOLD for CONSECUTIVE_FRAMES
    2. EAR rises back above OPEN_THRESHOLD
    """

    def __init__(self):
        """Initialize the blink detector with UniFace models."""
        self.detector = RetinaFace()
        self.landmarker = Landmark106()

        # State for blink detection
        self.blink_count = 0
        self.eye_closed_frames = 0
        self.was_eye_closed = False
        self.previous_ear = None

    def reset(self):
        """Reset blink detection state for a new session."""
        self.blink_count = 0
        self.eye_closed_frames = 0
        self.was_eye_closed = False
        self.previous_ear = None

    def get_landmarks(self, image: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[dict]]:
        """
        Detect face and get 106-point landmarks.

        Args:
            image: BGR image array

        Returns:
            Tuple of (landmarks array (106, 2), face dict) or (None, None) if no face
        """
        faces = self.detector.detect(image)

        if not faces:
            return None, None

        # Use the first/largest face
        face = faces[0]
        bbox = face["bbox"]

        landmarks = self.landmarker.get_landmarks(image, bbox)
        return landmarks, face

    def calculate_average_ear(self, landmarks: np.ndarray) -> Tuple[float, float, float]:
        """
        Calculate EAR for both eyes and return average.

        Args:
            landmarks: 106-point landmarks array

        Returns:
            Tuple of (average_ear, left_ear, right_ear)
        """
        # Extract eye landmarks
        right_eye = landmarks[RIGHT_EYE_INDICES]
        left_eye = landmarks[LEFT_EYE_INDICES]

        right_ear = calculate_ear(right_eye)
        left_ear = calculate_ear(left_eye)

        average_ear = (left_ear + right_ear) / 2.0
        return average_ear, left_ear, right_ear

    def process_frame(self, image: np.ndarray) -> dict:
        """
        Process a single frame for blink detection.

        Updates internal state and returns detection results.

        Args:
            image: BGR image array

        Returns:
            dict with keys:
            - blink_detected: bool, True if a blink was just completed
            - ear_value: float, current average EAR
            - left_ear: float, left eye EAR
            - right_ear: float, right eye EAR
            - blink_count: int, total blinks in session
            - left_eye_open: bool
            - right_eye_open: bool
            - face_detected: bool
            - error: optional error message
        """
        start_time = time.time()
        blink_detected = False

        try:
            landmarks, face = self.get_landmarks(image)

            if landmarks is None:
                return {
                    "blink_detected": False,
                    "ear_value": 0.0,
                    "left_ear": 0.0,
                    "right_ear": 0.0,
                    "blink_count": self.blink_count,
                    "left_eye_open": False,
                    "right_eye_open": False,
                    "face_detected": False,
                    "processing_time_ms": int((time.time() - start_time) * 1000),
                }

            avg_ear, left_ear, right_ear = self.calculate_average_ear(landmarks)

            # Determine if eyes are open
            left_eye_open = left_ear > EAR_BLINK_THRESHOLD
            right_eye_open = right_ear > EAR_BLINK_THRESHOLD
            eyes_open = avg_ear > EAR_BLINK_THRESHOLD

            # Blink detection state machine
            if not eyes_open:
                self.eye_closed_frames += 1
                if self.eye_closed_frames >= CONSECUTIVE_FRAMES_FOR_BLINK:
                    self.was_eye_closed = True
            else:
                # Eyes are open now
                if self.was_eye_closed:
                    # Transition from closed to open = blink completed
                    self.blink_count += 1
                    blink_detected = True
                    self.was_eye_closed = False

                self.eye_closed_frames = 0

            self.previous_ear = avg_ear

            return {
                "blink_detected": blink_detected,
                "ear_value": avg_ear,
                "left_ear": left_ear,
                "right_ear": right_ear,
                "blink_count": self.blink_count,
                "left_eye_open": left_eye_open,
                "right_eye_open": right_eye_open,
                "face_detected": True,
                "processing_time_ms": int((time.time() - start_time) * 1000),
            }

        except Exception as e:
            return {
                "blink_detected": False,
                "ear_value": 0.0,
                "left_ear": 0.0,
                "right_ear": 0.0,
                "blink_count": self.blink_count,
                "left_eye_open": False,
                "right_eye_open": False,
                "face_detected": False,
                "processing_time_ms": int((time.time() - start_time) * 1000),
                "error": str(e),
            }


# Global detector instance (lazy initialization)
_blink_detector: Optional[BlinkDetector] = None


def get_blink_detector() -> BlinkDetector:
    """Get or create the global blink detector instance."""
    global _blink_detector
    if _blink_detector is None:
        _blink_detector = BlinkDetector()
    return _blink_detector


def check_blink_from_base64(base64_image: str, reset_session: bool = False) -> dict:
    """
    Check for blink in a base64 encoded image.

    Args:
        base64_image: Base64 encoded image string
        reset_session: If True, reset blink count before processing

    Returns:
        dict with blink detection results
    """
    try:
        image = decode_base64_image(base64_image)
        detector = get_blink_detector()

        if reset_session:
            detector.reset()

        result = detector.process_frame(image)
        # PRIVACY: Explicitly delete image data from memory
        del image
        return result

    except Exception as e:
        return {
            "blink_detected": False,
            "ear_value": 0.0,
            "left_ear": 0.0,
            "right_ear": 0.0,
            "blink_count": 0,
            "left_eye_open": False,
            "right_eye_open": False,
            "face_detected": False,
            "processing_time_ms": 0,
            "error": f"Failed to process image: {str(e)}",
        }


def analyze_passive_liveness(frames: list[str]) -> dict:
    """
    Analyze multiple frames for passive liveness indicators.

    Processes a batch of frames to:
    1. Count total blinks
    2. Find the best frame for face matching (highest confidence)
    3. Calculate average anti-spoofing indicators

    Args:
        frames: List of base64 encoded image strings

    Returns:
        dict with:
        - total_blinks: int
        - best_frame_index: int
        - best_frame_confidence: float
        - average_ear: float
        - is_likely_real: bool (at least 1 blink detected)
        - processing_time_ms: int
    """
    start_time = time.time()

    if not frames:
        return {
            "total_blinks": 0,
            "best_frame_index": 0,
            "best_frame_confidence": 0.0,
            "average_ear": 0.0,
            "is_likely_real": False,
            "processing_time_ms": 0,
            "error": "No frames provided",
        }

    # Reset detector for fresh analysis
    detector = get_blink_detector()
    detector.reset()

    best_frame_index = 0
    best_frame_confidence = 0.0
    ear_values = []

    for i, frame_b64 in enumerate(frames):
        try:
            image = decode_base64_image(frame_b64)

            # Process for blink detection
            result = detector.process_frame(image)

            # PRIVACY: Explicitly delete image data from memory after processing
            del image

            if result.get("face_detected"):
                ear_values.append(result.get("ear_value", 0.0))

                # Track best frame (simplified: use consistent face detection)
                # In production, could also factor in face size, centering, etc.
                if result.get("ear_value", 0) > 0.2:  # Eyes are open
                    confidence = 1.0 if result.get("face_detected") else 0.0
                    if confidence > best_frame_confidence:
                        best_frame_confidence = confidence
                        best_frame_index = i

        except Exception:
            continue

    total_blinks = detector.blink_count
    average_ear = sum(ear_values) / len(ear_values) if ear_values else 0.0

    # A real person should blink at least once in a typical session
    is_likely_real = total_blinks >= 1

    return {
        "total_blinks": total_blinks,
        "best_frame_index": best_frame_index,
        "best_frame_confidence": best_frame_confidence,
        "average_ear": average_ear,
        "is_likely_real": is_likely_real,
        "processing_time_ms": int((time.time() - start_time) * 1000),
    }
