"""
Head Pose Detection Module using UniFace 106-point Landmarks.

This module provides head pose estimation for liveness verification
by analyzing facial landmark positions.

Uses a simplified 3-point approach:
- Nose tip position relative to face contour
- Left/right face width ratio indicates yaw (left/right turn)

106-point landmark indices (standard InsightFace ordering):
- Left face contour: indices 0-16 (17 points)
- Right face contour: indices 17-32 (16 points)
- Nose tip: index 86
- Nose base: indices 87-90
"""

import time
from typing import Optional

import numpy as np
from uniface import Landmark106, RetinaFace

from .antispoof import decode_base64_image

# Head pose thresholds
YAW_THRESHOLD = 0.10  # Ratio difference indicating head turn (lowered for easier detection)
YAW_STRONG_THRESHOLD = 0.25  # Strong turn indication
CONSECUTIVE_FRAMES_FOR_TURN = 2  # Frames with turn to confirm

# 106-point landmark indices
LEFT_FACE_CONTOUR = 0  # Leftmost point of face contour
RIGHT_FACE_CONTOUR = 32  # Rightmost point of face contour
NOSE_TIP = 54  # Nose tip
LEFT_EYE_CENTER = 87  # Left eye inner corner (approximation for center)
RIGHT_EYE_CENTER = 33  # Right eye outer corner (approximation for center)
CHIN = 16  # Chin point


def calculate_head_yaw(landmarks: np.ndarray) -> float:
    """
    Calculate head yaw (left/right rotation) from 106-point landmarks.

    Uses the nose position relative to face width to determine rotation.

    Returns:
        float: Yaw value from -1.0 (full left turn) to 1.0 (full right turn).
               0.0 indicates facing forward.
    """
    if len(landmarks) < 106:
        return 0.0

    # Get key points
    left_contour = landmarks[LEFT_FACE_CONTOUR]
    right_contour = landmarks[RIGHT_FACE_CONTOUR]
    nose_tip = landmarks[NOSE_TIP]

    # Calculate face width
    face_width = np.linalg.norm(right_contour - left_contour)
    if face_width < 1:  # Avoid division by zero
        return 0.0

    # Calculate nose position relative to face center
    face_center_x = (left_contour[0] + right_contour[0]) / 2
    nose_offset = nose_tip[0] - face_center_x

    # Normalize by face width (results in -0.5 to 0.5 range)
    # Multiply by 2 to get -1.0 to 1.0 range
    yaw = (nose_offset / face_width) * 2

    # Clamp to [-1, 1]
    return max(-1.0, min(1.0, float(yaw)))


def calculate_head_pitch(landmarks: np.ndarray) -> float:
    """
    Calculate head pitch (up/down tilt) from 106-point landmarks.

    Uses the vertical position of nose tip relative to eye line.

    Returns:
        float: Pitch value from -1.0 (looking down) to 1.0 (looking up).
               0.0 indicates level gaze.
    """
    if len(landmarks) < 106:
        return 0.0

    # Get key points
    left_eye = landmarks[LEFT_EYE_CENTER]
    right_eye = landmarks[RIGHT_EYE_CENTER]
    nose_tip = landmarks[NOSE_TIP]
    chin = landmarks[CHIN]

    # Calculate eye line height
    eye_center_y = (left_eye[1] + right_eye[1]) / 2

    # Calculate face height (eye to chin)
    face_height = abs(chin[1] - eye_center_y)
    if face_height < 1:
        return 0.0

    # Expected nose position is roughly 40% down from eyes to chin
    expected_nose_y = eye_center_y + (face_height * 0.4)

    # Calculate deviation
    nose_deviation = nose_tip[1] - expected_nose_y

    # Normalize (negative = looking up, positive = looking down)
    pitch = (nose_deviation / face_height) * 2.5

    # Invert so positive = looking up
    return max(-1.0, min(1.0, float(-pitch)))


class HeadPoseDetector:
    """
    Stateful head pose detector using UniFace 106-point landmarks.

    Tracks head turns across multiple frames for stable detection.
    """

    def __init__(self):
        """Initialize the head pose detector with UniFace models."""
        self.detector = RetinaFace()
        self.landmarker = Landmark106()

        # State for turn detection
        self.left_turn_frames = 0
        self.right_turn_frames = 0
        self.previous_yaw = 0.0
        self.turn_detected_left = False
        self.turn_detected_right = False

    def reset(self):
        """Reset head pose detection state for a new session."""
        self.left_turn_frames = 0
        self.right_turn_frames = 0
        self.previous_yaw = 0.0
        self.turn_detected_left = False
        self.turn_detected_right = False

    def get_landmarks(self, image: np.ndarray) -> tuple[Optional[np.ndarray], Optional[dict]]:
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

    def process_frame(self, image: np.ndarray) -> dict:
        """
        Process a single frame for head pose detection.

        Updates internal state and returns detection results.

        Args:
            image: BGR image array

        Returns:
            dict with keys:
            - yaw: float, head yaw (-1 to 1, negative=left, positive=right)
            - pitch: float, head pitch (-1 to 1, negative=down, positive=up)
            - direction: str, estimated direction ("forward", "left", "right", "up", "down")
            - is_turning_left: bool, True if currently turning left
            - is_turning_right: bool, True if currently turning right
            - left_turn_completed: bool, True if left turn detected in session
            - right_turn_completed: bool, True if right turn detected in session
            - face_detected: bool
            - processing_time_ms: int
            - error: optional error message
        """
        start_time = time.time()

        try:
            landmarks, face = self.get_landmarks(image)

            if landmarks is None:
                return {
                    "yaw": 0.0,
                    "pitch": 0.0,
                    "direction": "unknown",
                    "is_turning_left": False,
                    "is_turning_right": False,
                    "left_turn_completed": self.turn_detected_left,
                    "right_turn_completed": self.turn_detected_right,
                    "face_detected": False,
                    "processing_time_ms": int((time.time() - start_time) * 1000),
                }

            yaw = calculate_head_yaw(landmarks)
            pitch = calculate_head_pitch(landmarks)

            # Determine direction (from user's perspective, not camera)
            # Positive yaw = nose moved right in camera = user turned LEFT
            # Negative yaw = nose moved left in camera = user turned RIGHT
            direction = "forward"
            if abs(yaw) > YAW_THRESHOLD:
                direction = "left" if yaw > 0 else "right"
            elif abs(pitch) > 0.2:
                direction = "up" if pitch > 0 else "down"

            # Track turn state (from user's perspective)
            is_turning_left = yaw > YAW_THRESHOLD
            is_turning_right = yaw < -YAW_THRESHOLD

            # Count consecutive frames for turn confirmation
            if is_turning_left:
                self.left_turn_frames += 1
                self.right_turn_frames = 0
            elif is_turning_right:
                self.right_turn_frames += 1
                self.left_turn_frames = 0
            else:
                # Reset counters when facing forward
                self.left_turn_frames = 0
                self.right_turn_frames = 0

            # Confirm turn after enough consecutive frames
            if self.left_turn_frames >= CONSECUTIVE_FRAMES_FOR_TURN:
                self.turn_detected_left = True
            if self.right_turn_frames >= CONSECUTIVE_FRAMES_FOR_TURN:
                self.turn_detected_right = True

            self.previous_yaw = yaw

            return {
                "yaw": round(yaw, 3),
                "pitch": round(pitch, 3),
                "direction": direction,
                "is_turning_left": is_turning_left,
                "is_turning_right": is_turning_right,
                "left_turn_completed": self.turn_detected_left,
                "right_turn_completed": self.turn_detected_right,
                "face_detected": True,
                "processing_time_ms": int((time.time() - start_time) * 1000),
            }

        except Exception as e:
            return {
                "yaw": 0.0,
                "pitch": 0.0,
                "direction": "unknown",
                "is_turning_left": False,
                "is_turning_right": False,
                "left_turn_completed": self.turn_detected_left,
                "right_turn_completed": self.turn_detected_right,
                "face_detected": False,
                "processing_time_ms": int((time.time() - start_time) * 1000),
                "error": str(e),
            }


# Global detector instance (lazy initialization)
_head_pose_detector: Optional[HeadPoseDetector] = None


def get_head_pose_detector() -> HeadPoseDetector:
    """Get or create the global head pose detector instance."""
    global _head_pose_detector
    if _head_pose_detector is None:
        _head_pose_detector = HeadPoseDetector()
    return _head_pose_detector


def check_head_pose_from_base64(base64_image: str, reset_session: bool = False) -> dict:
    """
    Check head pose in a base64 encoded image.

    Args:
        base64_image: Base64 encoded image string
        reset_session: If True, reset turn detection state before processing

    Returns:
        dict with head pose detection results
    """
    try:
        image = decode_base64_image(base64_image)
        detector = get_head_pose_detector()

        if reset_session:
            detector.reset()

        result = detector.process_frame(image)
        # PRIVACY: Explicitly delete image data from memory
        del image
        return result

    except Exception as e:
        return {
            "yaw": 0.0,
            "pitch": 0.0,
            "direction": "unknown",
            "is_turning_left": False,
            "is_turning_right": False,
            "left_turn_completed": False,
            "right_turn_completed": False,
            "face_detected": False,
            "processing_time_ms": 0,
            "error": f"Failed to process image: {str(e)}",
        }


def detect_head_turn(base64_image: str, required_direction: str, threshold: float = YAW_THRESHOLD) -> dict:
    """
    Check if head is turned in the required direction.

    Args:
        base64_image: Base64 encoded image string
        required_direction: "left" or "right"
        threshold: Yaw threshold for turn detection (default 0.15)

    Returns:
        dict with:
        - turn_detected: bool, whether turn was detected in required direction
        - yaw: float, current yaw value
        - direction: str, current direction
        - meets_threshold: bool, whether threshold was met
    """
    try:
        image = decode_base64_image(base64_image)
        detector = get_head_pose_detector()

        landmarks, _ = detector.get_landmarks(image)

        # PRIVACY: Delete image after processing
        del image

        if landmarks is None:
            return {
                "turn_detected": False,
                "yaw": 0.0,
                "direction": "unknown",
                "meets_threshold": False,
                "error": "No face detected",
            }

        yaw = calculate_head_yaw(landmarks)

        # Note: Yaw sign is relative to camera view, not user's perspective
        # When user turns RIGHT (their right), nose moves LEFT in camera → yaw is NEGATIVE
        # When user turns LEFT (their left), nose moves RIGHT in camera → yaw is POSITIVE
        # So we INVERT the comparison to match user's perspective
        if required_direction == "left":
            turn_detected = yaw > threshold  # positive yaw = user turned left
        elif required_direction == "right":
            turn_detected = yaw < -threshold  # negative yaw = user turned right
        else:
            turn_detected = False

        direction = "forward"
        if yaw > threshold:
            direction = "left"  # user's left
        elif yaw < -threshold:
            direction = "right"  # user's right

        return {
            "turn_detected": turn_detected,
            "yaw": round(yaw, 3),
            "direction": direction,
            "meets_threshold": turn_detected,
            "required_direction": required_direction,
        }

    except Exception as e:
        return {
            "turn_detected": False,
            "yaw": 0.0,
            "direction": "unknown",
            "meets_threshold": False,
            "error": f"Failed to process: {str(e)}",
        }
