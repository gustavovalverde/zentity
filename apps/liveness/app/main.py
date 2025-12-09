"""
Liveness Detection Service - FastAPI Application

Privacy-preserving face verification service for zkKYC.

This service provides REST endpoints for face detection, liveness
verification, and face matching using DeepFace.

IMPORTANT: All biometric data (face embeddings, images) is processed
transiently and NEVER stored. Only boolean verification results are returned.

Endpoints:
- GET  /health       - Service health check
- POST /detect       - Detect faces in image
- POST /liveness     - Full liveness check (detection + anti-spoofing)
- POST /antispoof    - Anti-spoofing check only
- POST /face-match   - Compare ID photo to selfie (privacy-preserving)
- POST /verify       - Full verification (liveness + face matching)
"""

import os
import time
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .liveness import check_liveness_from_base64, validate_selfie
from .detector import detect_faces_from_base64
from .antispoof import check_antispoof_from_base64, decode_base64_image
from .face_match import compare_faces_from_base64, verify_identity_match
from .zk_proof import generate_face_match_proof, verify_face_match_proof
from .facial_analysis import (
    validate_liveness_challenge,
    check_smile,
    analyze_facial_attributes,
)
from .blink_detection import (
    check_blink_from_base64,
    analyze_passive_liveness,
)
from .frame_selector import (
    evaluate_frame_from_base64,
    select_best_frame,
)
from .head_pose import (
    check_head_pose_from_base64,
    detect_head_turn,
)
from .challenge_engine import (
    ChallengeType,
    create_challenge_session,
    get_session,
    complete_session_challenge,
    validate_multi_challenge_batch,
)

# Configuration
PORT = int(os.getenv("PORT", "5003"))
ANTISPOOF_THRESHOLD = float(os.getenv("ANTISPOOF_THRESHOLD", "0.3"))

# Initialize FastAPI
app = FastAPI(
    title="Liveness Detection Service",
    description="Face detection and anti-spoofing service for KYC verification",
    version="1.0.0"
)

# CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request/Response models
class ImageRequest(BaseModel):
    """Request body for image-based endpoints."""
    image: str = Field(..., description="Base64 encoded image (with or without data URL prefix)")
    threshold: Optional[float] = Field(
        default=None,
        description="Anti-spoofing threshold (0.0-1.0). Defaults to server config."
    )


class BoundingBox(BaseModel):
    """Face bounding box coordinates."""
    x: int
    y: int
    width: int
    height: int


class LivenessResponse(BaseModel):
    """Response for liveness check endpoint."""
    is_real: bool = Field(..., description="Whether the image passes liveness check")
    antispoof_score: float = Field(..., description="Anti-spoofing confidence (0.0-1.0)")
    face_count: int = Field(..., description="Number of faces detected")
    bounding_box: Optional[BoundingBox] = Field(None, description="Primary face location")
    processing_time_ms: int = Field(..., description="Processing time in milliseconds")
    issues: Optional[list] = Field(None, description="List of detected issues")
    error: Optional[str] = Field(None, description="Error message if failed")


class DetectResponse(BaseModel):
    """Response for face detection endpoint."""
    face_count: int
    faces: list
    processing_time_ms: int
    error: Optional[str] = None


class AntispoofResponse(BaseModel):
    """Response for anti-spoofing endpoint."""
    is_real: bool
    antispoof_score: float
    processing_time_ms: int
    error: Optional[str] = None


class HealthResponse(BaseModel):
    """Response for health check endpoint."""
    status: str
    service: str
    version: str
    uptime_seconds: float


# Track service start time
_start_time = time.time()


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Service health check endpoint.

    Returns service status, version, and uptime.
    Models are warmed up via entrypoint.sh before uvicorn starts.
    """
    return HealthResponse(
        status="healthy",
        service="liveness-detection",
        version="1.0.0",
        uptime_seconds=round(time.time() - _start_time, 2)
    )


@app.post("/detect", response_model=DetectResponse)
async def detect_faces_endpoint(request: ImageRequest):
    """
    Detect faces in an image.

    Returns the number of faces and their bounding boxes.
    Does not perform anti-spoofing check.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    result = detect_faces_from_base64(request.image)

    return DetectResponse(
        face_count=result.get("face_count", 0),
        faces=result.get("faces", []),
        processing_time_ms=result.get("processing_time_ms", 0),
        error=result.get("error")
    )


@app.post("/liveness", response_model=LivenessResponse)
async def liveness_check_endpoint(request: ImageRequest):
    """
    Perform full liveness check on an image.

    This combines face detection with anti-spoofing to verify
    that the image contains a real, live face.

    Returns:
    - is_real: True if passes liveness check (single real face)
    - antispoof_score: Confidence score (0.0-1.0)
    - face_count: Number of faces detected
    - bounding_box: Location of primary face
    - issues: List of problems found (if any)
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    threshold = request.threshold if request.threshold is not None else ANTISPOOF_THRESHOLD
    result = check_liveness_from_base64(request.image, threshold)

    # Convert bounding_box to model
    bbox = result.get("bounding_box")
    bounding_box = BoundingBox(**bbox) if bbox else None

    return LivenessResponse(
        is_real=result.get("is_real", False),
        antispoof_score=result.get("antispoof_score", 0.0),
        face_count=result.get("face_count", 0),
        bounding_box=bounding_box,
        processing_time_ms=result.get("processing_time_ms", 0),
        issues=result.get("issues"),
        error=result.get("error")
    )


@app.post("/antispoof", response_model=AntispoofResponse)
async def antispoof_check_endpoint(request: ImageRequest):
    """
    Perform anti-spoofing check only.

    Uses DeepFace FasNet to detect presentation attacks
    (photos, screens, masks).
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    threshold = request.threshold if request.threshold is not None else ANTISPOOF_THRESHOLD
    result = check_antispoof_from_base64(request.image, threshold)

    return AntispoofResponse(
        is_real=result.get("is_real", False),
        antispoof_score=result.get("antispoof_score", 0.0),
        processing_time_ms=result.get("processing_time_ms", 0),
        error=result.get("error")
    )


@app.post("/validate-selfie")
async def validate_selfie_endpoint(request: ImageRequest):
    """
    Validate a selfie image for KYC purposes.

    Convenience endpoint that returns a simplified validation result.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    result = validate_selfie(request.image)

    return result


# ============================================================================
# Liveness Challenge Endpoints (Interactive Liveness)
# ============================================================================


class ChallengeRequest(BaseModel):
    """Request for liveness challenge validation."""

    baselineImage: str = Field(
        ..., description="Base64 encoded baseline image (neutral face)"
    )
    challengeImage: str = Field(
        ..., description="Base64 encoded challenge image (after prompt)"
    )
    challengeType: str = Field(
        default="smile",
        description="Type of challenge: 'smile'",
    )
    minEmotionChange: Optional[float] = Field(
        default=20.0,
        description="Minimum required change in emotion score (0-100)",
    )
    smileThreshold: Optional[float] = Field(
        default=50.0,
        description="Minimum happiness score to detect smile (0-100)",
    )


class ChallengeResponse(BaseModel):
    """Response for liveness challenge validation."""

    passed: bool = Field(..., description="Whether the challenge was passed")
    challengeType: str = Field(..., description="Type of challenge performed")
    baselineEmotion: Optional[str] = Field(
        None, description="Dominant emotion at baseline"
    )
    challengeEmotion: Optional[str] = Field(
        None, description="Dominant emotion after challenge"
    )
    emotionChange: Optional[float] = Field(
        None, description="Change in target emotion score"
    )
    message: str = Field(..., description="User-friendly result message")
    processingTimeMs: int = Field(..., description="Processing time in milliseconds")
    error: Optional[str] = Field(None, description="Error code if failed")


class SmileCheckRequest(BaseModel):
    """Request for single-frame smile detection."""

    image: str = Field(..., description="Base64 encoded image")
    threshold: Optional[float] = Field(
        default=50.0,
        description="Minimum happiness score to detect smile (0-100)",
    )


class SmileCheckResponse(BaseModel):
    """Response for smile detection."""

    isSmiling: bool = Field(..., description="Whether person is smiling")
    happyScore: float = Field(..., description="Happiness score (0-100)")
    dominantEmotion: Optional[str] = Field(None, description="Strongest detected emotion")
    passed: bool = Field(..., description="Whether threshold was met")
    processingTimeMs: int = Field(..., description="Processing time in milliseconds")
    error: Optional[str] = Field(None, description="Error message if failed")


@app.post("/challenge/validate", response_model=ChallengeResponse)
async def validate_challenge_endpoint(request: ChallengeRequest):
    """
    Validate a liveness challenge by comparing baseline and challenge images.

    This proves liveness by requiring the user to change their expression
    on command. Static photos cannot respond to prompts.

    Flow:
    1. Capture baseline (user with neutral/normal face)
    2. Prompt user to perform action (e.g., "Please smile!")
    3. Capture challenge image
    4. Server validates that emotion changed appropriately

    Currently supported challenges:
    - smile: User must show a clear smile (happiness score increase)

    Privacy: All images are processed transiently and never stored.
    """
    if not request.baselineImage:
        raise HTTPException(status_code=400, detail="Baseline image is required")
    if not request.challengeImage:
        raise HTTPException(status_code=400, detail="Challenge image is required")

    try:
        baseline_np = decode_base64_image(request.baselineImage)
        challenge_np = decode_base64_image(request.challengeImage)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode image: {str(e)}")

    result = validate_liveness_challenge(
        baseline_image=baseline_np,
        challenge_image=challenge_np,
        challenge_type=request.challengeType,
        min_emotion_change=request.minEmotionChange or 20.0,
        smile_threshold=request.smileThreshold or 50.0,
    )

    # PRIVACY: Explicitly delete image data from memory
    del baseline_np
    del challenge_np

    return ChallengeResponse(
        passed=result.get("passed", False),
        challengeType=result.get("challenge_type", request.challengeType),
        baselineEmotion=result.get("baseline_emotion"),
        challengeEmotion=result.get("challenge_emotion"),
        emotionChange=result.get("emotion_change"),
        message=result.get("message", "Challenge validation complete"),
        processingTimeMs=result.get("processing_time_ms", 0),
        error=result.get("error"),
    )


@app.post("/smile-check", response_model=SmileCheckResponse)
async def smile_check_endpoint(request: SmileCheckRequest):
    """
    Check if person is smiling in a single frame.

    This is a simpler endpoint for real-time feedback during the
    challenge flow. Can be used to guide users before capturing
    the final challenge image.

    Returns whether a smile is detected above the threshold.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    try:
        image_np = decode_base64_image(request.image)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode image: {str(e)}")

    result = check_smile(image_np, threshold=request.threshold or 50.0)

    # PRIVACY: Explicitly delete image data from memory
    del image_np

    return SmileCheckResponse(
        isSmiling=result.get("is_smiling", False),
        happyScore=result.get("happy_score", 0.0),
        dominantEmotion=result.get("dominant_emotion"),
        passed=result.get("passed", False),
        processingTimeMs=result.get("processing_time_ms", 0),
        error=result.get("error"),
    )


@app.post("/analyze-face")
async def analyze_face_endpoint(request: ImageRequest):
    """
    Analyze facial attributes in an image.

    Returns emotion scores and face region. Useful for debugging
    and real-time feedback during liveness checks.

    If the face is obscured, this will fail - which is the primary
    mechanism for detecting hand-over-face and similar issues.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    try:
        image_np = decode_base64_image(request.image)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to decode image: {str(e)}")

    result = analyze_facial_attributes(image_np)

    # PRIVACY: Explicitly delete image data from memory
    del image_np

    return {
        "success": result.get("success", False),
        "emotions": result.get("emotions"),
        "dominantEmotion": result.get("dominant_emotion"),
        "region": result.get("region"),
        "processingTimeMs": result.get("processing_time_ms", 0),
        "error": result.get("error"),
        "details": result.get("details"),
    }


# ============================================================================
# Blink Detection & Passive Liveness Endpoints
# ============================================================================


class BlinkCheckRequest(BaseModel):
    """Request for blink detection in a single frame."""

    image: str = Field(..., description="Base64 encoded image")
    resetSession: bool = Field(
        default=False,
        description="Reset blink count before processing",
    )


class BlinkCheckResponse(BaseModel):
    """Response for blink detection."""

    blinkDetected: bool = Field(..., description="Whether a blink was just detected")
    earValue: float = Field(..., description="Eye Aspect Ratio (0.0-0.4 typical)")
    leftEar: float = Field(..., description="Left eye EAR")
    rightEar: float = Field(..., description="Right eye EAR")
    blinkCount: int = Field(..., description="Total blinks in session")
    leftEyeOpen: bool = Field(..., description="Whether left eye is open")
    rightEyeOpen: bool = Field(..., description="Whether right eye is open")
    faceDetected: bool = Field(..., description="Whether a face was detected")
    processingTimeMs: int = Field(..., description="Processing time in milliseconds")
    error: Optional[str] = Field(None, description="Error message if failed")


class PassiveMonitorRequest(BaseModel):
    """Request for analyzing multiple frames for passive liveness."""

    frames: list = Field(..., description="List of base64 encoded frames")


class PassiveMonitorResponse(BaseModel):
    """Response for passive monitoring analysis."""

    totalBlinks: int = Field(..., description="Total blinks detected across frames")
    bestFrameIndex: int = Field(..., description="Index of best frame for face matching")
    bestFrameConfidence: float = Field(..., description="Confidence of best frame")
    averageEar: float = Field(..., description="Average EAR across frames")
    isLikelyReal: bool = Field(..., description="Whether passive checks suggest real person")
    processingTimeMs: int = Field(..., description="Total processing time")
    error: Optional[str] = Field(None, description="Error message if failed")


@app.post("/blink-check", response_model=BlinkCheckResponse)
async def blink_check_endpoint(request: BlinkCheckRequest):
    """
    Check for blink in a single frame using Eye Aspect Ratio.

    Uses UniFace 106-point landmarks to calculate EAR for each eye.
    A blink is detected when EAR drops below threshold and rises again.

    This endpoint is stateful - it tracks blinks across calls within a session.
    Use resetSession=true to start a new session.

    Privacy: Image is processed transiently and never stored.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    result = check_blink_from_base64(request.image, request.resetSession)

    return BlinkCheckResponse(
        blinkDetected=result.get("blink_detected", False),
        earValue=result.get("ear_value", 0.0),
        leftEar=result.get("left_ear", 0.0),
        rightEar=result.get("right_ear", 0.0),
        blinkCount=result.get("blink_count", 0),
        leftEyeOpen=result.get("left_eye_open", False),
        rightEyeOpen=result.get("right_eye_open", False),
        faceDetected=result.get("face_detected", False),
        processingTimeMs=result.get("processing_time_ms", 0),
        error=result.get("error"),
    )


@app.post("/passive-monitor", response_model=PassiveMonitorResponse)
async def passive_monitor_endpoint(request: PassiveMonitorRequest):
    """
    Analyze multiple frames for passive liveness indicators.

    Processes a batch of frames to:
    1. Count total blinks (proves person is alive and responsive)
    2. Find the best frame for face matching
    3. Calculate average EAR (eye openness)

    A real person should blink naturally during a session.
    Static photos or videos typically fail blink detection.

    Privacy: All frames are processed transiently and never stored.
    """
    if not request.frames:
        raise HTTPException(status_code=400, detail="Frames are required")

    result = analyze_passive_liveness(request.frames)

    return PassiveMonitorResponse(
        totalBlinks=result.get("total_blinks", 0),
        bestFrameIndex=result.get("best_frame_index", 0),
        bestFrameConfidence=result.get("best_frame_confidence", 0.0),
        averageEar=result.get("average_ear", 0.0),
        isLikelyReal=result.get("is_likely_real", False),
        processingTimeMs=result.get("processing_time_ms", 0),
        error=result.get("error"),
    )


class FrameEvaluateRequest(BaseModel):
    """Request for evaluating a single frame's quality."""

    image: str = Field(..., description="Base64 encoded image")


class FrameEvaluateResponse(BaseModel):
    """Response for frame evaluation."""

    isSuitable: bool = Field(..., description="Whether frame meets quality criteria")
    score: float = Field(..., description="Quality score (0.0-1.0)")
    faceConfidence: float = Field(..., description="Face detection confidence")
    faceCount: int = Field(..., description="Number of faces detected")
    faceAreaRatio: float = Field(..., description="Face area as ratio of image")
    facialAnalysisSuccess: bool = Field(..., description="Whether facial analysis succeeded")
    issues: Optional[list] = Field(None, description="List of issues found")
    processingTimeMs: int = Field(..., description="Processing time")
    error: Optional[str] = Field(None, description="Error message if failed")


@app.post("/evaluate-frame", response_model=FrameEvaluateResponse)
async def evaluate_frame_endpoint(request: FrameEvaluateRequest):
    """
    Evaluate a single frame's suitability for face matching.

    Checks:
    - Face detection confidence >= 0.85
    - Single face detected
    - Face not obscured

    Returns a quality score and suitability flag.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    result = evaluate_frame_from_base64(request.image)

    return FrameEvaluateResponse(
        isSuitable=result.get("is_suitable", False),
        score=result.get("score", 0.0),
        faceConfidence=result.get("face_confidence", 0.0),
        faceCount=result.get("face_count", 0),
        faceAreaRatio=result.get("face_area_ratio", 0.0),
        facialAnalysisSuccess=result.get("facial_analysis_success", False),
        issues=result.get("issues"),
        processingTimeMs=result.get("processing_time_ms", 0),
        error=result.get("error"),
    )


# ============================================================================
# Face Matching Endpoints (Privacy-Preserving)
# ============================================================================


class FaceMatchRequest(BaseModel):
    """Request for face matching between ID photo and selfie."""

    idImage: str = Field(..., description="Base64 encoded ID document image")
    selfieImage: str = Field(..., description="Base64 encoded selfie image")
    minConfidence: Optional[float] = Field(
        default=0.6,
        description="Minimum confidence threshold for match (0.0-1.0)",
    )


class FaceMatchProofRequest(BaseModel):
    """Request for face matching with ZK proof generation."""

    idImage: str = Field(..., description="Base64 encoded ID document image")
    selfieImage: str = Field(..., description="Base64 encoded selfie image")
    proofThreshold: Optional[float] = Field(
        default=0.6,
        description="Threshold for ZK proof (0.0-1.0). Proof will show score >= threshold.",
    )


class FaceMatchProofResponse(BaseModel):
    """
    Face matching response with ZK proof.

    Privacy note: The ZK proof cryptographically proves that the similarity
    score meets the threshold WITHOUT revealing the exact score. The proof
    can be verified by any relying party.
    """

    matched: bool = Field(..., description="Whether faces match")
    confidence: float = Field(..., description="Match confidence (0.0-1.0)")
    processing_time_ms: int = Field(..., description="Face match processing time")

    # ZK proof fields
    proof: Optional[dict] = Field(None, description="Groth16 ZK proof")
    publicSignals: Optional[list] = Field(None, description="Public signals for verification")
    proofIsMatch: Optional[bool] = Field(None, description="Whether proof shows match")
    proofThreshold: Optional[float] = Field(None, description="Threshold used in proof")
    proofGenerationTimeMs: Optional[int] = Field(None, description="Proof generation time")
    solidityCalldata: Optional[str] = Field(None, description="Calldata for on-chain verification")

    id_face_extracted: bool = Field(default=False, description="Whether ID face was cropped")
    error: Optional[str] = Field(None, description="Error message if failed")
    proofError: Optional[str] = Field(None, description="ZK proof error if proof generation failed")


class FaceMatchResponse(BaseModel):
    """
    Face matching response.

    Privacy note: No face embeddings or biometric templates are included.
    Only boolean results are returned. All biometric data is discarded
    immediately after processing.
    """

    matched: bool = Field(..., description="Whether faces match")
    confidence: float = Field(..., description="Match confidence (0.0-1.0)")
    distance: Optional[float] = Field(None, description="Similarity distance")
    processing_time_ms: int = Field(..., description="Processing time")
    id_face_extracted: bool = Field(default=False, description="Whether ID face was cropped")
    id_face_image: Optional[str] = Field(None, description="Cropped ID face as base64 for UI display")
    error: Optional[str] = Field(None, description="Error message if failed")


@app.post("/face-match", response_model=FaceMatchResponse)
async def face_match_endpoint(request: FaceMatchRequest):
    """
    Compare faces between ID document photo and selfie.

    Privacy-preserving face matching:
    1. Extracts face embeddings from both images (transient)
    2. Computes similarity distance
    3. Returns match result as boolean
    4. IMMEDIATELY DISCARDS all embeddings and images

    No biometric templates are stored. Only the boolean match result
    and confidence score are returned.

    Args:
        idImage: Base64 encoded image from ID document
        selfieImage: Base64 encoded selfie image
        minConfidence: Minimum confidence threshold (default 0.6)

    Returns:
        FaceMatchResponse with match result and confidence
    """
    if not request.idImage:
        raise HTTPException(status_code=400, detail="ID image is required")
    if not request.selfieImage:
        raise HTTPException(status_code=400, detail="Selfie image is required")

    result = compare_faces_from_base64(
        id_image_base64=request.idImage,
        selfie_image_base64=request.selfieImage,
    )

    return FaceMatchResponse(
        matched=result.get("matched", False),
        confidence=result.get("confidence", 0.0),
        distance=result.get("distance"),
        processing_time_ms=result.get("processing_time_ms", 0),
        id_face_extracted=result.get("id_face_extracted", False),
        id_face_image=result.get("id_face_image"),
        error=result.get("error"),
    )


@app.post("/face-match-proof", response_model=FaceMatchProofResponse)
async def face_match_proof_endpoint(request: FaceMatchProofRequest):
    """
    Compare faces with ZK proof generation.

    This endpoint performs face matching and generates a cryptographic
    Zero-Knowledge proof that the similarity score meets the threshold
    WITHOUT revealing the exact score.

    Privacy guarantees:
    - The exact similarity score is kept private
    - Only threshold and isMatch are public in the proof
    - Any relying party can verify the proof
    - No biometric data is stored or transmitted

    Use cases:
    - Banks/exchanges needing cryptographic proof of identity match
    - Regulatory compliance with verifiable claims
    - Privacy-preserving identity verification

    Args:
        idImage: Base64 encoded ID document image
        selfieImage: Base64 encoded selfie image
        proofThreshold: Minimum threshold for ZK proof (default 0.6)

    Returns:
        FaceMatchProofResponse with face match result and ZK proof
    """
    if not request.idImage:
        raise HTTPException(status_code=400, detail="ID image is required")
    if not request.selfieImage:
        raise HTTPException(status_code=400, detail="Selfie image is required")

    # Step 1: Perform face matching
    result = compare_faces_from_base64(
        id_image_base64=request.idImage,
        selfie_image_base64=request.selfieImage,
    )

    confidence = result.get("confidence", 0.0)
    proof_threshold = request.proofThreshold or 0.6

    # Step 2: Generate ZK proof
    proof_result = await generate_face_match_proof(
        similarity_score=confidence,
        threshold=proof_threshold,
    )

    if proof_result.get("success"):
        return FaceMatchProofResponse(
            matched=result.get("matched", False),
            confidence=confidence,
            processing_time_ms=result.get("processing_time_ms", 0),
            proof=proof_result.get("proof"),
            publicSignals=proof_result.get("publicSignals"),
            proofIsMatch=proof_result.get("isMatch"),
            proofThreshold=proof_result.get("threshold"),
            proofGenerationTimeMs=proof_result.get("generationTimeMs"),
            solidityCalldata=proof_result.get("solidityCalldata"),
            id_face_extracted=result.get("id_face_extracted", False),
            error=result.get("error"),
            proofError=None,
        )
    else:
        return FaceMatchProofResponse(
            matched=result.get("matched", False),
            confidence=confidence,
            processing_time_ms=result.get("processing_time_ms", 0),
            proof=None,
            publicSignals=None,
            proofIsMatch=None,
            proofThreshold=proof_threshold,
            proofGenerationTimeMs=None,
            solidityCalldata=None,
            id_face_extracted=result.get("id_face_extracted", False),
            error=result.get("error"),
            proofError=proof_result.get("error"),
        )


class FullVerificationRequest(BaseModel):
    """Request for full identity verification (liveness + face matching)."""

    idImage: str = Field(..., description="Base64 encoded ID document image")
    selfieImage: str = Field(..., description="Base64 encoded selfie image")
    antispoofThreshold: Optional[float] = Field(
        default=None,
        description="Anti-spoofing threshold (uses server default if not provided)",
    )
    minFaceMatchConfidence: Optional[float] = Field(
        default=0.4,
        description="Minimum face match confidence (0.0-1.0). Default 0.4 allows ID photos with different lighting/angles.",
    )


class FullVerificationResponse(BaseModel):
    """
    Full verification response combining liveness and face matching.

    This is the recommended endpoint for complete identity verification.
    All biometric data is processed transiently and never stored.
    """

    # Overall result
    verified: bool = Field(..., description="Overall verification passed")

    # Liveness check results
    is_live: bool = Field(..., description="Selfie passes liveness check")
    antispoof_score: float = Field(..., description="Anti-spoofing score")

    # Face match results
    faces_match: bool = Field(..., description="ID photo matches selfie")
    face_match_confidence: float = Field(..., description="Match confidence")

    # Metadata
    processing_time_ms: int = Field(..., description="Total processing time")
    issues: list = Field(default_factory=list, description="Any issues found")
    error: Optional[str] = Field(None, description="Error message if failed")


@app.post("/verify", response_model=FullVerificationResponse)
async def full_verification_endpoint(request: FullVerificationRequest):
    """
    Full identity verification combining liveness and face matching.

    This is the recommended endpoint for complete KYC identity verification.

    Verification steps:
    1. Liveness check on selfie (anti-spoofing)
    2. Face matching between ID photo and selfie
    3. Combined verification result

    Privacy guarantees:
    - All images processed in memory only
    - Face embeddings extracted and immediately discarded
    - No biometric templates stored
    - Only boolean verification flags returned

    A user is verified if:
    - Selfie passes liveness check (is a real person, not a photo/screen)
    - Face in selfie matches face in ID document

    Returns:
        FullVerificationResponse with complete verification results
    """
    if not request.idImage:
        raise HTTPException(status_code=400, detail="ID image is required")
    if not request.selfieImage:
        raise HTTPException(status_code=400, detail="Selfie image is required")

    start_time = time.time()
    issues = []

    # Step 1: Liveness check on selfie
    threshold = (
        request.antispoofThreshold
        if request.antispoofThreshold is not None
        else ANTISPOOF_THRESHOLD
    )
    liveness_result = check_liveness_from_base64(request.selfieImage, threshold)

    is_live = liveness_result.get("is_real", False)
    antispoof_score = liveness_result.get("antispoof_score", 0.0)

    if liveness_result.get("error"):
        issues.append(f"liveness_error: {liveness_result['error']}")
    if liveness_result.get("issues"):
        issues.extend(liveness_result["issues"])

    # Step 2: Face matching (only if liveness passed or we want full results)
    face_match_result = compare_faces_from_base64(
        id_image_base64=request.idImage,
        selfie_image_base64=request.selfieImage,
    )

    faces_match = face_match_result.get("matched", False)
    face_match_confidence = face_match_result.get("confidence", 0.0)

    if face_match_result.get("error"):
        issues.append(f"face_match_error: {face_match_result['error']}")

    # Check confidence threshold
    if faces_match and face_match_confidence < request.minFaceMatchConfidence:
        faces_match = False
        issues.append("face_match_confidence_too_low")

    # Step 3: Combined verification
    verified = is_live and faces_match

    processing_time_ms = int((time.time() - start_time) * 1000)

    return FullVerificationResponse(
        verified=verified,
        is_live=is_live,
        antispoof_score=antispoof_score,
        faces_match=faces_match,
        face_match_confidence=face_match_confidence,
        processing_time_ms=processing_time_ms,
        issues=issues,
        error=None,
    )


# ============================================================================
# Head Pose Detection Endpoints
# ============================================================================


class HeadPoseRequest(BaseModel):
    """Request for head pose detection."""

    image: str = Field(..., description="Base64 encoded image")
    resetSession: bool = Field(
        default=False,
        description="Reset turn detection state before processing",
    )


class HeadPoseResponse(BaseModel):
    """Response for head pose detection."""

    yaw: float = Field(..., description="Head yaw (-1 to 1, negative=left, positive=right)")
    pitch: float = Field(..., description="Head pitch (-1 to 1, negative=down, positive=up)")
    direction: str = Field(..., description="Estimated direction (forward, left, right, up, down)")
    isTurningLeft: bool = Field(..., description="Whether head is currently turned left")
    isTurningRight: bool = Field(..., description="Whether head is currently turned right")
    leftTurnCompleted: bool = Field(..., description="Whether left turn detected in session")
    rightTurnCompleted: bool = Field(..., description="Whether right turn detected in session")
    faceDetected: bool = Field(..., description="Whether a face was detected")
    processingTimeMs: int = Field(..., description="Processing time in milliseconds")
    error: Optional[str] = Field(None, description="Error message if failed")


class HeadTurnCheckRequest(BaseModel):
    """Request for head turn check in a specific direction."""

    image: str = Field(..., description="Base64 encoded image")
    direction: str = Field(..., description="Required direction: 'left' or 'right'")
    threshold: Optional[float] = Field(
        default=0.15,
        description="Yaw threshold for turn detection (0.0-1.0)",
    )


class HeadTurnCheckResponse(BaseModel):
    """Response for head turn check."""

    turnDetected: bool = Field(..., description="Whether turn was detected in required direction")
    yaw: float = Field(..., description="Current yaw value")
    direction: str = Field(..., description="Current detected direction")
    meetsThreshold: bool = Field(..., description="Whether threshold was met")
    requiredDirection: str = Field(..., description="The direction that was requested")
    error: Optional[str] = Field(None, description="Error message if failed")


@app.post("/head-pose", response_model=HeadPoseResponse)
async def head_pose_endpoint(request: HeadPoseRequest):
    """
    Detect head pose in a single frame.

    Uses UniFace 106-point landmarks to estimate head orientation.
    Returns yaw (left/right) and pitch (up/down) values.

    This endpoint is stateful - it tracks turns across calls within a session.
    Use resetSession=true to start a new session.

    Privacy: Image is processed transiently and never stored.
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")

    result = check_head_pose_from_base64(request.image, request.resetSession)

    return HeadPoseResponse(
        yaw=result.get("yaw", 0.0),
        pitch=result.get("pitch", 0.0),
        direction=result.get("direction", "unknown"),
        isTurningLeft=result.get("is_turning_left", False),
        isTurningRight=result.get("is_turning_right", False),
        leftTurnCompleted=result.get("left_turn_completed", False),
        rightTurnCompleted=result.get("right_turn_completed", False),
        faceDetected=result.get("face_detected", False),
        processingTimeMs=result.get("processing_time_ms", 0),
        error=result.get("error"),
    )


@app.post("/head-turn-check", response_model=HeadTurnCheckResponse)
async def head_turn_check_endpoint(request: HeadTurnCheckRequest):
    """
    Check if head is turned in the required direction.

    Simpler endpoint for validating a specific head turn challenge.

    Args:
        image: Base64 encoded image
        direction: Required direction ("left" or "right")
        threshold: Optional custom threshold (default 0.15)
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="Image is required")
    if request.direction not in ["left", "right"]:
        raise HTTPException(status_code=400, detail="Direction must be 'left' or 'right'")

    result = detect_head_turn(
        request.image,
        request.direction,
        request.threshold or 0.15,
    )

    return HeadTurnCheckResponse(
        turnDetected=result.get("turn_detected", False),
        yaw=result.get("yaw", 0.0),
        direction=result.get("direction", "unknown"),
        meetsThreshold=result.get("meets_threshold", False),
        requiredDirection=result.get("required_direction", request.direction),
        error=result.get("error"),
    )


# ============================================================================
# Multi-Challenge Session Endpoints
# ============================================================================


class CreateSessionRequest(BaseModel):
    """Request to create a new challenge session."""

    numChallenges: int = Field(
        default=2,
        ge=2,
        le=4,
        description="Number of challenges (2-4)",
    )
    excludeChallenges: Optional[list[str]] = Field(
        default=None,
        description="Challenge types to exclude (smile, blink, turn_left, turn_right)",
    )
    requireHeadTurn: bool = Field(
        default=False,
        description="If true, include at least one head turn challenge",
    )


class ChallengeInfo(BaseModel):
    """Information about a challenge."""

    challengeType: str = Field(..., description="Challenge type")
    index: int = Field(..., description="Challenge index (0-based)")
    total: int = Field(..., description="Total challenges in session")
    title: str = Field(..., description="Display title")
    instruction: str = Field(..., description="User instruction")
    icon: str = Field(..., description="Icon name for UI")
    timeoutSeconds: int = Field(..., description="Timeout in seconds")


class SessionResponse(BaseModel):
    """Response with session state."""

    sessionId: str = Field(..., description="Unique session ID")
    challenges: list[str] = Field(..., description="List of challenge types")
    currentIndex: int = Field(..., description="Current challenge index")
    isComplete: bool = Field(..., description="Whether session is complete")
    isPassed: Optional[bool] = Field(None, description="Whether session passed (if complete)")
    currentChallenge: Optional[ChallengeInfo] = Field(None, description="Current challenge info")


class CompleteChallengeRequest(BaseModel):
    """Request to mark a challenge as completed."""

    sessionId: str = Field(..., description="Session ID")
    challengeType: str = Field(..., description="Challenge type that was completed")
    passed: bool = Field(..., description="Whether the challenge was passed")
    metadata: Optional[dict] = Field(None, description="Optional metadata (scores, etc.)")


class CompleteChallengeResponse(BaseModel):
    """Response for challenge completion."""

    success: bool = Field(..., description="Whether completion was recorded")
    passed: bool = Field(..., description="Whether this challenge passed")
    sessionComplete: bool = Field(..., description="Whether session is now complete")
    sessionPassed: Optional[bool] = Field(None, description="Whether session passed (if complete)")
    nextChallenge: Optional[ChallengeInfo] = Field(None, description="Next challenge (if any)")
    error: Optional[str] = Field(None, description="Error message if failed")


class MultiChallengeValidateRequest(BaseModel):
    """Request to validate multiple challenges at once."""

    baselineImage: str = Field(..., description="Base64 baseline image (neutral face)")
    challengeResults: list[dict] = Field(
        ...,
        description="List of {challenge_type, image} dicts",
    )


class ChallengeValidationResult(BaseModel):
    """Result for a single challenge validation."""

    index: int = Field(..., description="Challenge index")
    challengeType: str = Field(..., description="Challenge type")
    passed: bool = Field(..., description="Whether challenge passed")
    score: Optional[float] = Field(None, description="Score (if applicable)")
    error: Optional[str] = Field(None, description="Error message if failed")


class MultiChallengeValidateResponse(BaseModel):
    """Response for multi-challenge validation."""

    allPassed: bool = Field(..., description="Whether all challenges passed")
    totalChallenges: int = Field(..., description="Total number of challenges")
    passedCount: int = Field(..., description="Number of passed challenges")
    results: list[ChallengeValidationResult] = Field(..., description="Individual results")
    processingTimeMs: int = Field(..., description="Total processing time")


@app.post("/challenge/session", response_model=SessionResponse)
async def create_session_endpoint(request: CreateSessionRequest):
    """
    Create a new multi-challenge liveness session.

    Generates a random sequence of 2-4 challenges that the user must complete.
    This prevents replay attacks using static photos or pre-recorded videos.

    Supported challenges:
    - smile: Smile detection
    - blink: Eye blink detection
    - turn_left: Turn head to the left
    - turn_right: Turn head to the right

    Returns session info including the first challenge to display.
    """
    session_data = create_challenge_session(
        num_challenges=request.numChallenges,
        exclude_challenges=request.excludeChallenges,
        require_head_turn=request.requireHeadTurn,
    )

    current = session_data.get("current_challenge")
    current_info = None
    if current:
        current_info = ChallengeInfo(
            challengeType=current["challenge_type"],
            index=current["index"],
            total=current["total"],
            title=current["title"],
            instruction=current["instruction"],
            icon=current["icon"],
            timeoutSeconds=current["timeout_seconds"],
        )

    return SessionResponse(
        sessionId=session_data["session_id"],
        challenges=session_data["challenges"],
        currentIndex=session_data["current_index"],
        isComplete=session_data["is_complete"],
        isPassed=session_data["is_passed"] if session_data["is_complete"] else None,
        currentChallenge=current_info,
    )


@app.post("/challenge/complete", response_model=CompleteChallengeResponse)
async def complete_challenge_endpoint(request: CompleteChallengeRequest):
    """
    Mark a challenge as completed in a session.

    Call this after the user completes each challenge. The server tracks
    the session state and returns the next challenge or final result.
    """
    result = complete_session_challenge(
        session_id=request.sessionId,
        challenge_type=request.challengeType,
        passed=request.passed,
        metadata=request.metadata,
    )

    next_challenge = result.get("next_challenge")
    next_info = None
    if next_challenge:
        next_info = ChallengeInfo(
            challengeType=next_challenge["challenge_type"],
            index=next_challenge["index"],
            total=next_challenge["total"],
            title=next_challenge["title"],
            instruction=next_challenge["instruction"],
            icon=next_challenge["icon"],
            timeoutSeconds=next_challenge["timeout_seconds"],
        )

    return CompleteChallengeResponse(
        success=result.get("success", False),
        passed=result.get("passed", False),
        sessionComplete=result.get("session_complete", False),
        sessionPassed=result.get("session_passed"),
        nextChallenge=next_info,
        error=result.get("error"),
    )


@app.get("/challenge/session/{session_id}", response_model=SessionResponse)
async def get_session_endpoint(session_id: str):
    """
    Get the current state of a challenge session.
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    session_data = session.to_dict()

    current = session_data.get("current_challenge")
    current_info = None
    if current:
        current_info = ChallengeInfo(
            challengeType=current["challenge_type"],
            index=current["index"],
            total=current["total"],
            title=current["title"],
            instruction=current["instruction"],
            icon=current["icon"],
            timeoutSeconds=current["timeout_seconds"],
        )

    return SessionResponse(
        sessionId=session_data["session_id"],
        challenges=session_data["challenges"],
        currentIndex=session_data["current_index"],
        isComplete=session_data["is_complete"],
        isPassed=session_data["is_passed"] if session_data["is_complete"] else None,
        currentChallenge=current_info,
    )


@app.post("/challenge/validate-multi", response_model=MultiChallengeValidateResponse)
async def validate_multi_challenge_endpoint(request: MultiChallengeValidateRequest):
    """
    Validate multiple challenges at once.

    Alternative to session-based flow. The frontend collects all challenge
    images and sends them together for batch validation.

    Each challenge_result should have:
    - challenge_type: "smile", "blink", "turn_left", or "turn_right"
    - image: Base64 encoded image for that challenge

    Privacy: All images processed transiently and never stored.
    """
    if not request.baselineImage:
        raise HTTPException(status_code=400, detail="Baseline image is required")
    if not request.challengeResults:
        raise HTTPException(status_code=400, detail="Challenge results are required")

    result = validate_multi_challenge_batch(
        baseline_image=request.baselineImage,
        challenge_results=request.challengeResults,
    )

    validation_results = [
        ChallengeValidationResult(
            index=r["index"],
            challengeType=r["challenge_type"],
            passed=r["passed"],
            score=r.get("score") or r.get("yaw") or r.get("ear_value"),
            error=r.get("error"),
        )
        for r in result["results"]
    ]

    return MultiChallengeValidateResponse(
        allPassed=result["all_passed"],
        totalChallenges=result["total_challenges"],
        passedCount=result["passed_count"],
        results=validation_results,
        processingTimeMs=result["processing_time_ms"],
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
