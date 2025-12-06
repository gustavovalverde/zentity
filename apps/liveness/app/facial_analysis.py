"""
Facial attribute analysis for liveness challenges using DeepFace.

This module provides facial attribute detection (emotions) to enable
interactive liveness challenges. Instead of passive anti-spoofing,
we can prompt users to perform actions (smile, neutral face) and
verify the change in facial expression.

Key capabilities:
- Emotion detection (happy/smile, neutral, etc.)
- Face visibility validation (obscured faces fail analysis)
- Liveness challenge validation (baseline vs challenge comparison)
"""

import time
from typing import Optional

import numpy as np
from deepface import DeepFace


def analyze_facial_attributes(
    image: np.ndarray,
    detector_backend: str = "retinaface"
) -> dict:
    """
    Analyze facial attributes using DeepFace.

    This function extracts emotion data from a face image. If the face
    is obscured or not clearly visible, the analysis will fail.

    Args:
        image: numpy array of the image in RGB format
        detector_backend: face detector to use (default: retinaface)

    Returns:
        dict with keys:
        - success: bool indicating analysis succeeded
        - emotions: dict of emotion scores (0-100)
        - dominant_emotion: string of the strongest emotion
        - region: face bounding box
        - error: error message if failed
    """
    start_time = time.time()

    try:
        result = DeepFace.analyze(
            img_path=image,
            actions=['emotion'],
            detector_backend=detector_backend,
            enforce_detection=True  # Fail if face not properly detected
        )

        if not result or len(result) == 0:
            return {
                "success": False,
                "error": "no_analysis_result",
                "processing_time_ms": int((time.time() - start_time) * 1000)
            }

        analysis = result[0]
        return {
            "success": True,
            "emotions": analysis.get("emotion", {}),
            "dominant_emotion": analysis.get("dominant_emotion"),
            "region": analysis.get("region"),
            "processing_time_ms": int((time.time() - start_time) * 1000)
        }

    except ValueError as e:
        # "Face could not be detected" = face obscured or not visible
        return {
            "success": False,
            "error": "face_not_detected",
            "details": str(e),
            "processing_time_ms": int((time.time() - start_time) * 1000)
        }
    except Exception as e:
        return {
            "success": False,
            "error": "analysis_failed",
            "details": str(e),
            "processing_time_ms": int((time.time() - start_time) * 1000)
        }


def check_smile(
    image: np.ndarray,
    threshold: float = 50.0
) -> dict:
    """
    Check if person is smiling.

    Uses emotion analysis to detect happiness/smile. A smile is detected
    when the 'happy' emotion score exceeds the threshold.

    Args:
        image: numpy array of the image in RGB format
        threshold: minimum 'happy' score (0-100) to consider a smile

    Returns:
        dict with keys:
        - is_smiling: bool indicating if person is smiling
        - happy_score: the happiness score (0-100)
        - dominant_emotion: the strongest detected emotion
        - passed: bool indicating if threshold was met
        - error: error message if analysis failed
    """
    analysis = analyze_facial_attributes(image)

    if not analysis.get("success"):
        return {
            "is_smiling": False,
            "happy_score": 0.0,
            "passed": False,
            "error": analysis.get("error"),
            "details": analysis.get("details"),
            "processing_time_ms": analysis.get("processing_time_ms", 0)
        }

    emotions = analysis.get("emotions", {})
    happy_score = emotions.get("happy", 0)

    return {
        "is_smiling": happy_score >= threshold,
        "happy_score": happy_score,
        "dominant_emotion": analysis.get("dominant_emotion"),
        "passed": happy_score >= threshold,
        "all_emotions": emotions,
        "processing_time_ms": analysis.get("processing_time_ms", 0)
    }


def check_neutral(
    image: np.ndarray,
    threshold: float = 40.0
) -> dict:
    """
    Check if person has neutral expression.

    Used for baseline capture before challenge.

    Args:
        image: numpy array of the image in RGB format
        threshold: minimum 'neutral' score (0-100)

    Returns:
        dict with keys:
        - is_neutral: bool indicating neutral expression
        - neutral_score: the neutral score (0-100)
        - passed: bool indicating if threshold was met
        - error: error message if analysis failed
    """
    analysis = analyze_facial_attributes(image)

    if not analysis.get("success"):
        return {
            "is_neutral": False,
            "neutral_score": 0.0,
            "passed": False,
            "error": analysis.get("error"),
            "details": analysis.get("details"),
            "processing_time_ms": analysis.get("processing_time_ms", 0)
        }

    emotions = analysis.get("emotions", {})
    neutral_score = emotions.get("neutral", 0)

    return {
        "is_neutral": neutral_score >= threshold,
        "neutral_score": neutral_score,
        "dominant_emotion": analysis.get("dominant_emotion"),
        "passed": neutral_score >= threshold,
        "all_emotions": emotions,
        "processing_time_ms": analysis.get("processing_time_ms", 0)
    }


def validate_liveness_challenge(
    baseline_image: np.ndarray,
    challenge_image: np.ndarray,
    challenge_type: str = "smile",
    min_emotion_change: float = 20.0,
    smile_threshold: float = 50.0
) -> dict:
    """
    Validate a liveness challenge by comparing baseline and challenge images.

    This proves liveness by requiring the user to change their expression
    on command. Static photos cannot respond to prompts.

    Flow:
    1. Baseline: User shows neutral/normal face
    2. Challenge: User performs action (smile)
    3. Compare: Emotion should change significantly

    Args:
        baseline_image: numpy array of baseline (neutral) face
        challenge_image: numpy array after challenge prompt
        challenge_type: type of challenge ("smile")
        min_emotion_change: minimum required change in emotion score
        smile_threshold: minimum happiness score to detect smile

    Returns:
        dict with keys:
        - passed: bool indicating challenge was completed
        - challenge_type: the challenge performed
        - baseline_emotion: dominant emotion at baseline
        - challenge_emotion: dominant emotion after challenge
        - emotion_change: numeric change in target emotion
        - error: error message if failed
        - message: user-friendly status message
    """
    start_time = time.time()

    # Analyze baseline (should be any clear face)
    baseline_analysis = analyze_facial_attributes(baseline_image)
    if not baseline_analysis.get("success"):
        return {
            "passed": False,
            "error": "baseline_face_not_detected",
            "message": "Could not detect face in baseline image. Please ensure your face is clearly visible.",
            "processing_time_ms": int((time.time() - start_time) * 1000)
        }

    # Analyze challenge image based on challenge type
    if challenge_type == "smile":
        challenge_result = check_smile(challenge_image, threshold=smile_threshold)

        if challenge_result.get("error"):
            return {
                "passed": False,
                "error": challenge_result.get("error"),
                "message": "Could not detect face during smile challenge. Please ensure your face is clearly visible.",
                "processing_time_ms": int((time.time() - start_time) * 1000)
            }

        # Check if smiling enough
        if not challenge_result.get("is_smiling"):
            return {
                "passed": False,
                "error": "smile_not_detected",
                "message": "Please show a clear, natural smile.",
                "happy_score": challenge_result.get("happy_score", 0),
                "threshold": smile_threshold,
                "processing_time_ms": int((time.time() - start_time) * 1000)
            }

        # Verify emotion changed from baseline
        baseline_happy = baseline_analysis.get("emotions", {}).get("happy", 0)
        challenge_happy = challenge_result.get("happy_score", 0)
        emotion_change = challenge_happy - baseline_happy

        if emotion_change < min_emotion_change:
            return {
                "passed": False,
                "error": "insufficient_emotion_change",
                "message": "Your expression didn't change enough. Please smile more clearly!",
                "baseline_happy": baseline_happy,
                "challenge_happy": challenge_happy,
                "emotion_change": emotion_change,
                "min_required": min_emotion_change,
                "processing_time_ms": int((time.time() - start_time) * 1000)
            }

        # Challenge passed!
        return {
            "passed": True,
            "challenge_type": "smile",
            "baseline_emotion": baseline_analysis.get("dominant_emotion"),
            "challenge_emotion": challenge_result.get("dominant_emotion"),
            "baseline_happy": baseline_happy,
            "challenge_happy": challenge_happy,
            "emotion_change": emotion_change,
            "message": "Smile challenge passed!",
            "processing_time_ms": int((time.time() - start_time) * 1000)
        }

    return {
        "passed": False,
        "error": "unknown_challenge_type",
        "message": f"Unknown challenge type: {challenge_type}",
        "processing_time_ms": int((time.time() - start_time) * 1000)
    }


def check_face_visibility(image: np.ndarray) -> dict:
    """
    Check if face is clearly visible (not obscured).

    This is a simple check that attempts facial attribute analysis.
    If analysis succeeds, the face is visible. If it fails, the face
    is likely obscured (hand, object, poor lighting, etc.).

    Args:
        image: numpy array of the image in RGB format

    Returns:
        dict with keys:
        - visible: bool indicating face is clearly visible
        - dominant_emotion: detected emotion (if visible)
        - error: error message if face not visible
    """
    analysis = analyze_facial_attributes(image)

    if analysis.get("success"):
        return {
            "visible": True,
            "dominant_emotion": analysis.get("dominant_emotion"),
            "region": analysis.get("region"),
            "processing_time_ms": analysis.get("processing_time_ms", 0)
        }
    else:
        return {
            "visible": False,
            "error": analysis.get("error"),
            "details": analysis.get("details"),
            "processing_time_ms": analysis.get("processing_time_ms", 0)
        }
