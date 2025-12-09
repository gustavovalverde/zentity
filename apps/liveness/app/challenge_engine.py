"""
Multi-Challenge Liveness Engine.

This module provides a challenge session manager for multi-gesture liveness
verification. It generates random challenge sequences and validates them.

Supported challenges:
- smile: Smile detection using DeepFace emotion analysis
- blink: Eye blink detection using EAR (Eye Aspect Ratio)
- turn_left: Head turn to the left
- turn_right: Head turn to the right

A session consists of 2-3 random challenges that must be completed
to prove liveness. This prevents replay attacks using static photos
or pre-recorded videos.
"""

import random
import secrets
import time
from enum import Enum
from typing import Optional


class ChallengeType(str, Enum):
    """Available challenge types for liveness verification."""
    SMILE = "smile"
    BLINK = "blink"
    TURN_LEFT = "turn_left"
    TURN_RIGHT = "turn_right"


# Challenge instructions for the frontend
CHALLENGE_INSTRUCTIONS = {
    ChallengeType.SMILE: {
        "title": "Smile",
        "instruction": "Please smile!",
        "icon": "smile",
        "timeout_seconds": 10,
    },
    ChallengeType.BLINK: {
        "title": "Blink",
        "instruction": "Please blink your eyes",
        "icon": "eye",
        "timeout_seconds": 8,
    },
    ChallengeType.TURN_LEFT: {
        "title": "Turn Left",
        "instruction": "Turn your head to the left",
        "icon": "arrow-left",
        "timeout_seconds": 8,
    },
    ChallengeType.TURN_RIGHT: {
        "title": "Turn Right",
        "instruction": "Turn your head to the right",
        "icon": "arrow-right",
        "timeout_seconds": 8,
    },
}


class ChallengeSession:
    """
    Manages a multi-challenge liveness verification session.

    Creates a random sequence of challenges and tracks completion status.
    """

    def __init__(
        self,
        num_challenges: int = 2,
        exclude_challenges: Optional[list[ChallengeType]] = None,
        require_head_turn: bool = False,
    ):
        """
        Initialize a new challenge session.

        Args:
            num_challenges: Number of challenges to include (2-4)
            exclude_challenges: Challenge types to exclude from selection
            require_head_turn: If True, include at least one head turn challenge
        """
        self.session_id = secrets.token_hex(16)
        self.created_at = time.time()
        self.num_challenges = max(2, min(4, num_challenges))
        self.challenges = self._generate_challenges(exclude_challenges, require_head_turn)
        self.current_index = 0
        self.completed_challenges: list[dict] = []
        self.is_complete = False
        self.is_passed = False

    def _generate_challenges(
        self,
        exclude_challenges: Optional[list[ChallengeType]],
        require_head_turn: bool,
    ) -> list[ChallengeType]:
        """Generate a random sequence of challenges."""
        available = list(ChallengeType)

        # Remove excluded challenges
        if exclude_challenges:
            available = [c for c in available if c not in exclude_challenges]

        # Ensure we have enough challenges
        if len(available) < self.num_challenges:
            # Reset to all if too many excluded
            available = list(ChallengeType)

        # Build challenge list
        challenges = []

        # If head turn is required, add one first
        if require_head_turn:
            head_turns = [ChallengeType.TURN_LEFT, ChallengeType.TURN_RIGHT]
            head_turn = random.choice([h for h in head_turns if h in available])
            challenges.append(head_turn)
            available = [c for c in available if c != head_turn]

        # Fill remaining slots randomly
        remaining = self.num_challenges - len(challenges)
        if remaining > 0:
            # Avoid duplicates (except head turns can appear with smile/blink)
            selected = random.sample(available, min(remaining, len(available)))
            challenges.extend(selected)

        # Shuffle the final list
        random.shuffle(challenges)

        return challenges

    def get_current_challenge(self) -> Optional[dict]:
        """Get the current challenge to display to the user."""
        if self.current_index >= len(self.challenges):
            return None

        challenge_type = self.challenges[self.current_index]
        instructions = CHALLENGE_INSTRUCTIONS[challenge_type]

        return {
            "challenge_type": challenge_type.value,
            "index": self.current_index,
            "total": len(self.challenges),
            "title": instructions["title"],
            "instruction": instructions["instruction"],
            "icon": instructions["icon"],
            "timeout_seconds": instructions["timeout_seconds"],
        }

    def complete_challenge(self, challenge_type: str, passed: bool, metadata: Optional[dict] = None) -> dict:
        """
        Mark a challenge as completed.

        Args:
            challenge_type: The challenge type that was completed
            passed: Whether the challenge was passed
            metadata: Optional metadata about the completion (scores, etc.)

        Returns:
            dict with completion status
        """
        # Verify this is the expected challenge
        if self.current_index >= len(self.challenges):
            return {
                "success": False,
                "error": "Session already complete",
            }

        expected = self.challenges[self.current_index]
        if challenge_type != expected.value:
            return {
                "success": False,
                "error": f"Expected challenge {expected.value}, got {challenge_type}",
            }

        # Record completion
        self.completed_challenges.append({
            "challenge_type": challenge_type,
            "passed": passed,
            "completed_at": time.time(),
            "metadata": metadata or {},
        })

        # Move to next or finish
        self.current_index += 1

        if self.current_index >= len(self.challenges):
            self.is_complete = True
            # Session passes only if ALL challenges passed
            self.is_passed = all(c["passed"] for c in self.completed_challenges)

        return {
            "success": True,
            "passed": passed,
            "session_complete": self.is_complete,
            "session_passed": self.is_passed if self.is_complete else None,
            "next_challenge": self.get_current_challenge(),
        }

    def to_dict(self) -> dict:
        """Serialize session state for API responses."""
        return {
            "session_id": self.session_id,
            "created_at": self.created_at,
            "challenges": [c.value for c in self.challenges],
            "current_index": self.current_index,
            "completed_challenges": self.completed_challenges,
            "is_complete": self.is_complete,
            "is_passed": self.is_passed,
            "current_challenge": self.get_current_challenge(),
        }


# Session storage (in-memory for simplicity - use Redis in production)
_sessions: dict[str, ChallengeSession] = {}


def create_challenge_session(
    num_challenges: int = 2,
    exclude_challenges: Optional[list[str]] = None,
    require_head_turn: bool = False,
) -> dict:
    """
    Create a new challenge session.

    Args:
        num_challenges: Number of challenges (2-4)
        exclude_challenges: List of challenge type strings to exclude
        require_head_turn: If True, include at least one head turn

    Returns:
        Session state dict
    """
    exclude = None
    if exclude_challenges:
        exclude = [ChallengeType(c) for c in exclude_challenges if c in [ct.value for ct in ChallengeType]]

    session = ChallengeSession(
        num_challenges=num_challenges,
        exclude_challenges=exclude,
        require_head_turn=require_head_turn,
    )

    _sessions[session.session_id] = session

    # Clean up old sessions (older than 10 minutes)
    cleanup_age = time.time() - 600
    expired = [sid for sid, s in _sessions.items() if s.created_at < cleanup_age]
    for sid in expired:
        del _sessions[sid]

    return session.to_dict()


def get_session(session_id: str) -> Optional[ChallengeSession]:
    """Get a session by ID."""
    return _sessions.get(session_id)


def complete_session_challenge(
    session_id: str,
    challenge_type: str,
    passed: bool,
    metadata: Optional[dict] = None,
) -> dict:
    """
    Mark a challenge as completed in a session.

    Args:
        session_id: The session ID
        challenge_type: The challenge type that was completed
        passed: Whether the challenge was passed
        metadata: Optional metadata about completion

    Returns:
        Completion result dict
    """
    session = _sessions.get(session_id)
    if not session:
        return {
            "success": False,
            "error": "Session not found or expired",
        }

    return session.complete_challenge(challenge_type, passed, metadata)


def validate_multi_challenge_batch(
    baseline_image: str,
    challenge_results: list[dict],
) -> dict:
    """
    Validate a batch of completed challenges.

    This is for cases where the frontend collects all challenge images
    and sends them together for validation.

    Args:
        baseline_image: Base64 baseline image (neutral face)
        challenge_results: List of dicts with:
            - challenge_type: str
            - image: str (base64)

    Returns:
        Validation result dict
    """
    from .facial_analysis import check_smile
    from .blink_detection import check_blink_from_base64
    from .head_pose import check_head_pose_from_base64
    from .antispoof import decode_base64_image

    start_time = time.time()
    results = []
    all_passed = True

    for i, challenge in enumerate(challenge_results):
        challenge_type = challenge.get("challenge_type")
        image = challenge.get("image")

        if not challenge_type or not image:
            results.append({
                "index": i,
                "challenge_type": challenge_type,
                "passed": False,
                "error": "Missing challenge_type or image",
            })
            all_passed = False
            continue

        try:
            if challenge_type == ChallengeType.SMILE.value:
                # Check smile
                image_np = decode_base64_image(image)
                result = check_smile(image_np, threshold=30.0)
                del image_np
                passed = result.get("is_smiling", False)
                results.append({
                    "index": i,
                    "challenge_type": challenge_type,
                    "passed": passed,
                    "score": result.get("happy_score", 0),
                })

            elif challenge_type == ChallengeType.BLINK.value:
                # Check if blink occurred (need multiple frames ideally)
                result = check_blink_from_base64(image, reset_session=True)
                # For single frame, check if eyes are closed
                passed = result.get("ear_value", 1.0) < 0.21
                results.append({
                    "index": i,
                    "challenge_type": challenge_type,
                    "passed": passed,
                    "ear_value": result.get("ear_value", 0),
                })

            elif challenge_type in [ChallengeType.TURN_LEFT.value, ChallengeType.TURN_RIGHT.value]:
                # Check head turn
                result = check_head_pose_from_base64(image, reset_session=True)
                direction = "left" if challenge_type == ChallengeType.TURN_LEFT.value else "right"
                yaw = result.get("yaw", 0)

                if direction == "left":
                    passed = yaw < -0.15
                else:
                    passed = yaw > 0.15

                results.append({
                    "index": i,
                    "challenge_type": challenge_type,
                    "passed": passed,
                    "yaw": yaw,
                    "detected_direction": result.get("direction", "unknown"),
                })

            else:
                results.append({
                    "index": i,
                    "challenge_type": challenge_type,
                    "passed": False,
                    "error": f"Unknown challenge type: {challenge_type}",
                })
                all_passed = False
                continue

            if not results[-1]["passed"]:
                all_passed = False

        except Exception as e:
            results.append({
                "index": i,
                "challenge_type": challenge_type,
                "passed": False,
                "error": str(e),
            })
            all_passed = False

    return {
        "all_passed": all_passed,
        "total_challenges": len(challenge_results),
        "passed_count": sum(1 for r in results if r.get("passed", False)),
        "results": results,
        "processing_time_ms": int((time.time() - start_time) * 1000),
    }
