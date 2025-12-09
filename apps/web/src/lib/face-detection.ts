/**
 * Face detection and liveness validation for selfie capture.
 *
 * This module calls the liveness service for face detection and
 * anti-spoofing checks using DeepFace.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LivenessResult {
  isReal: boolean;
  antispoofScore: number;
  faceCount: number;
  boundingBox: BoundingBox | null;
  processingTimeMs: number;
  issues: string[] | null;
  error?: string;
}

export interface SelfieValidationResult {
  isValid: boolean;
  issues: string[];
  livenessResult: LivenessResult | null;
}

/**
 * Check if liveness service is available.
 */
export async function isLivenessServiceAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/api/liveness/health");
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === "healthy";
  } catch {
    return false;
  }
}

/**
 * Check liveness of an image using the liveness service.
 *
 * @param imageBase64 - Base64 encoded image (with or without data URL prefix)
 * @returns Liveness check result
 */
export async function checkLiveness(
  imageBase64: string,
): Promise<LivenessResult> {
  try {
    const response = await fetch("/api/liveness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64 }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        isReal: false,
        antispoofScore: 0,
        faceCount: 0,
        boundingBox: null,
        processingTimeMs: 0,
        issues: ["service_error"],
        error: `Service error: ${response.status} - ${error}`,
      };
    }

    const result = await response.json();

    // Map snake_case response to camelCase
    return {
      isReal: result.is_real ?? false,
      antispoofScore: result.antispoof_score ?? 0,
      faceCount: result.face_count ?? 0,
      boundingBox: result.bounding_box
        ? {
            x: result.bounding_box.x,
            y: result.bounding_box.y,
            width: result.bounding_box.width,
            height: result.bounding_box.height,
          }
        : null,
      processingTimeMs: result.processing_time_ms ?? 0,
      issues: result.issues,
      error: result.error,
    };
  } catch (error) {
    return {
      isReal: false,
      antispoofScore: 0,
      faceCount: 0,
      boundingBox: null,
      processingTimeMs: 0,
      issues: ["network_error"],
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate a selfie image for KYC purposes.
 *
 * This performs a full liveness check and returns a validation result
 * indicating whether the selfie is acceptable.
 *
 * @param imageBase64 - Base64 encoded selfie image
 * @returns Validation result with issues list
 */
export async function validateSelfie(
  imageBase64: string,
): Promise<SelfieValidationResult> {
  // Check if service is available
  const serviceAvailable = await isLivenessServiceAvailable();

  if (!serviceAvailable) {
    return {
      isValid: true, // Allow through with warning
      issues: [],
      livenessResult: null,
    };
  }

  const result = await checkLiveness(imageBase64);
  const issues: string[] = result.issues || [];

  // Determine validity
  const isValid =
    result.isReal && result.faceCount === 1 && issues.length === 0;

  return {
    isValid,
    issues,
    livenessResult: result,
  };
}

/**
 * Get human-readable description for an issue code.
 */
export function getIssueDescription(issue: string): string {
  const descriptions: Record<string, string> = {
    no_face: "No face detected. Please ensure your face is clearly visible.",
    multiple_faces:
      "Multiple faces detected. Please take a selfie with only yourself.",
    spoof_detected:
      "Liveness check failed. Please use a real camera, not a photo.",
    face_too_small: "Face is too small. Please move closer to the camera.",
    face_obscured:
      "Your face appears to be covered. Please remove any obstructions.",
    low_face_confidence: "Face not clearly visible. Please improve lighting.",
    processing_error: "An error occurred during processing. Please try again.",
    service_error: "Liveness service unavailable. Please try again later.",
    network_error: "Network error. Please check your connection and try again.",
    invalid_image: "Invalid image format. Please capture a new photo.",
    baseline_face_not_detected:
      "Could not detect face in baseline. Please ensure your face is visible.",
    smile_not_detected: "Please show a clear, natural smile.",
    insufficient_emotion_change:
      "Your expression didn't change enough. Please smile more clearly!",
  };

  return descriptions[issue] || "Unknown issue with the image.";
}

/**
 * Liveness challenge result from the challenge validation endpoint.
 */
export interface ChallengeResult {
  passed: boolean;
  challengeType: string;
  baselineEmotion?: string;
  challengeEmotion?: string;
  emotionChange?: number;
  message: string;
  processingTimeMs: number;
  error?: string;
}

/**
 * Validate a liveness challenge by comparing baseline and challenge images.
 *
 * This proves liveness by requiring the user to change their expression
 * (e.g., smile) on command. Static photos cannot respond to prompts.
 *
 * @param baselineImage - Base64 encoded baseline image (neutral face)
 * @param challengeImage - Base64 encoded challenge image (after smile prompt)
 * @param challengeType - Type of challenge: 'smile' (default)
 * @returns Challenge validation result
 */
export async function validateLivenessChallenge(
  baselineImage: string,
  challengeImage: string,
  challengeType: string = "smile",
): Promise<ChallengeResult> {
  try {
    const response = await fetch("/api/liveness/challenge/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baselineImage,
        challengeImage,
        challengeType,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        passed: false,
        challengeType,
        message: `Service error: ${response.status}`,
        processingTimeMs: 0,
        error: `Service error: ${response.status} - ${error}`,
      };
    }

    const result = await response.json();

    return {
      passed: result.passed ?? false,
      challengeType: result.challengeType ?? challengeType,
      baselineEmotion: result.baselineEmotion,
      challengeEmotion: result.challengeEmotion,
      emotionChange: result.emotionChange,
      message: result.message ?? "Challenge validation complete",
      processingTimeMs: result.processingTimeMs ?? 0,
      error: result.error,
    };
  } catch (error) {
    return {
      passed: false,
      challengeType,
      message: "Network error during challenge validation",
      processingTimeMs: 0,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if person is smiling in a single frame.
 *
 * Used for real-time feedback during challenge flow.
 *
 * @param imageBase64 - Base64 encoded image
 * @returns Smile detection result
 */
export async function checkSmile(imageBase64: string): Promise<{
  isSmiling: boolean;
  happyScore: number;
  dominantEmotion?: string;
  passed: boolean;
  processingTimeMs: number;
  error?: string;
}> {
  try {
    const response = await fetch("/api/liveness/smile-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64 }),
    });

    if (!response.ok) {
      return {
        isSmiling: false,
        happyScore: 0,
        passed: false,
        processingTimeMs: 0,
        error: `Service error: ${response.status}`,
      };
    }

    const result = await response.json();

    return {
      isSmiling: result.isSmiling ?? false,
      happyScore: result.happyScore ?? 0,
      dominantEmotion: result.dominantEmotion,
      passed: result.passed ?? false,
      processingTimeMs: result.processingTimeMs ?? 0,
      error: result.error,
    };
  } catch (error) {
    return {
      isSmiling: false,
      happyScore: 0,
      passed: false,
      processingTimeMs: 0,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Detect faces in an image (detection only, no anti-spoofing).
 *
 * @param imageBase64 - Base64 encoded image
 * @returns Face detection result
 */
export async function detectFaces(imageBase64: string): Promise<{
  faceCount: number;
  faces: Array<{ boundingBox: BoundingBox; confidence: number }>;
  processingTimeMs: number;
  error?: string;
}> {
  try {
    const response = await fetch("/api/liveness/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64 }),
    });

    if (!response.ok) {
      return {
        faceCount: 0,
        faces: [],
        processingTimeMs: 0,
        error: `Service error: ${response.status}`,
      };
    }

    const result = await response.json();

    return {
      faceCount: result.face_count ?? 0,
      faces: (result.faces || []).map(
        (f: { bounding_box: BoundingBox; confidence: number }) => ({
          boundingBox: f.bounding_box,
          confidence: f.confidence,
        }),
      ),
      processingTimeMs: result.processing_time_ms ?? 0,
      error: result.error,
    };
  } catch (error) {
    return {
      faceCount: 0,
      faces: [],
      processingTimeMs: 0,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Blink detection result from passive liveness monitoring.
 */
export interface BlinkCheckResult {
  blinkDetected: boolean;
  earValue: number;
  blinkCount: number;
  faceDetected: boolean;
  processingTimeMs: number;
  error?: string;
}

/**
 * Check for blinks in a single frame using Eye Aspect Ratio (EAR).
 *
 * Used for passive liveness monitoring during selfie capture.
 * Stateful: maintains blink count across calls (use resetSession to start fresh).
 *
 * @param imageBase64 - Base64 encoded image
 * @param resetSession - Reset blink count (default: false)
 * @returns Blink detection result
 */
export async function checkBlink(
  imageBase64: string,
  resetSession: boolean = false,
): Promise<BlinkCheckResult> {
  try {
    const response = await fetch("/api/liveness/blink-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64, resetSession }),
    });

    if (!response.ok) {
      return {
        blinkDetected: false,
        earValue: 0,
        blinkCount: 0,
        faceDetected: false,
        processingTimeMs: 0,
        error: `Service error: ${response.status}`,
      };
    }

    const result = await response.json();

    return {
      blinkDetected: result.blinkDetected ?? false,
      earValue: result.earValue ?? 0,
      blinkCount: result.blinkCount ?? 0,
      faceDetected: result.faceDetected ?? false,
      processingTimeMs: result.processingTimeMs ?? 0,
      error: result.error,
    };
  } catch (error) {
    return {
      blinkDetected: false,
      earValue: 0,
      blinkCount: 0,
      faceDetected: false,
      processingTimeMs: 0,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Passive liveness monitoring result from batch frame analysis.
 */
export interface PassiveMonitorResult {
  totalBlinks: number;
  bestFrameIndex: number;
  bestFrameScore: number;
  isLikelyReal: boolean;
  framesAnalyzed: number;
  processingTimeMs: number;
  error?: string;
}

/**
 * Analyze multiple frames for passive liveness indicators.
 *
 * Processes a batch of frames to:
 * - Count total natural blinks
 * - Select the best frame for face matching
 * - Determine if behavior appears natural (likely real person)
 *
 * @param frames - Array of base64 encoded images
 * @returns Passive monitoring analysis result
 */
export async function analyzePassiveMonitor(
  frames: string[],
): Promise<PassiveMonitorResult> {
  try {
    const response = await fetch("/api/liveness/passive-monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames }),
    });

    if (!response.ok) {
      return {
        totalBlinks: 0,
        bestFrameIndex: 0,
        bestFrameScore: 0,
        isLikelyReal: false,
        framesAnalyzed: 0,
        processingTimeMs: 0,
        error: `Service error: ${response.status}`,
      };
    }

    const result = await response.json();

    return {
      totalBlinks: result.totalBlinks ?? 0,
      bestFrameIndex: result.bestFrameIndex ?? 0,
      bestFrameScore: result.bestFrameScore ?? 0,
      isLikelyReal: result.isLikelyReal ?? false,
      framesAnalyzed: result.framesAnalyzed ?? 0,
      processingTimeMs: result.processingTimeMs ?? 0,
      error: result.error,
    };
  } catch (error) {
    return {
      totalBlinks: 0,
      bestFrameIndex: 0,
      bestFrameScore: 0,
      isLikelyReal: false,
      framesAnalyzed: 0,
      processingTimeMs: 0,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Face matching result comparing two images.
 */
export interface FaceMatchResult {
  matched: boolean;
  confidence: number;
  distance: number;
  threshold: number;
  processingTimeMs: number;
  idFaceExtracted: boolean;
  idFaceImage?: string; // Cropped face from ID for UI display
  error?: string;
}

/**
 * Compare two face images to determine if they are the same person.
 *
 * Used to match the selfie against the ID document photo.
 *
 * @param idImage - Base64 encoded ID document image
 * @param selfieImage - Base64 encoded selfie image
 * @param minConfidence - Minimum confidence threshold (0.0-1.0, default: 0.6)
 * @returns Face matching result
 */
export async function matchFaces(
  idImage: string,
  selfieImage: string,
  minConfidence: number = 0.6,
): Promise<FaceMatchResult> {
  try {
    const response = await fetch("/api/liveness/face-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idImage, selfieImage, minConfidence }),
    });

    if (!response.ok) {
      return {
        matched: false,
        confidence: 0,
        distance: 1,
        threshold: minConfidence,
        processingTimeMs: 0,
        idFaceExtracted: false,
        error: `Service error: ${response.status}`,
      };
    }

    const result = await response.json();

    return {
      matched: result.matched ?? false,
      confidence: result.confidence ?? 0,
      distance: result.distance ?? 1,
      threshold: result.threshold ?? minConfidence,
      processingTimeMs: result.processing_time_ms ?? 0,
      idFaceExtracted: result.id_face_extracted ?? false,
      idFaceImage: result.id_face_image,
      error: result.error,
    };
  } catch (error) {
    return {
      matched: false,
      confidence: 0,
      distance: 1,
      threshold: minConfidence,
      processingTimeMs: 0,
      idFaceExtracted: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Head Pose Detection
// ============================================================================

/**
 * Head pose detection result.
 */
export interface HeadPoseResult {
  yaw: number; // -1 to 1, negative=left, positive=right
  pitch: number; // -1 to 1, negative=down, positive=up
  direction: string; // "forward", "left", "right", "up", "down"
  isTurningLeft: boolean;
  isTurningRight: boolean;
  leftTurnCompleted: boolean;
  rightTurnCompleted: boolean;
  faceDetected: boolean;
  processingTimeMs: number;
  error?: string;
}

/**
 * Check head pose in a single frame.
 *
 * Uses 106-point facial landmarks to estimate head orientation.
 * Stateful: tracks turns across calls (use resetSession to start fresh).
 *
 * @param imageBase64 - Base64 encoded image
 * @param resetSession - Reset turn tracking state (default: false)
 * @returns Head pose detection result
 */
export async function checkHeadPose(
  imageBase64: string,
  resetSession: boolean = false,
): Promise<HeadPoseResult> {
  try {
    const response = await fetch("/api/liveness/head-pose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64, resetSession }),
    });

    if (!response.ok) {
      return {
        yaw: 0,
        pitch: 0,
        direction: "unknown",
        isTurningLeft: false,
        isTurningRight: false,
        leftTurnCompleted: false,
        rightTurnCompleted: false,
        faceDetected: false,
        processingTimeMs: 0,
        error: `Service error: ${response.status}`,
      };
    }

    const result = await response.json();

    return {
      yaw: result.yaw ?? 0,
      pitch: result.pitch ?? 0,
      direction: result.direction ?? "unknown",
      isTurningLeft: result.isTurningLeft ?? false,
      isTurningRight: result.isTurningRight ?? false,
      leftTurnCompleted: result.leftTurnCompleted ?? false,
      rightTurnCompleted: result.rightTurnCompleted ?? false,
      faceDetected: result.faceDetected ?? false,
      processingTimeMs: result.processingTimeMs ?? 0,
      error: result.error,
    };
  } catch (error) {
    return {
      yaw: 0,
      pitch: 0,
      direction: "unknown",
      isTurningLeft: false,
      isTurningRight: false,
      leftTurnCompleted: false,
      rightTurnCompleted: false,
      faceDetected: false,
      processingTimeMs: 0,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if head is turned in a specific direction.
 *
 * Simpler API for validating head turn challenges.
 *
 * @param imageBase64 - Base64 encoded image
 * @param direction - Required direction: "left" or "right"
 * @param threshold - Yaw threshold (default: 0.15)
 */
export async function checkHeadTurn(
  imageBase64: string,
  direction: "left" | "right",
  threshold: number = 0.15,
): Promise<{
  turnDetected: boolean;
  yaw: number;
  direction: string;
  meetsThreshold: boolean;
  error?: string;
}> {
  try {
    const response = await fetch("/api/liveness/head-turn-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64, direction, threshold }),
    });

    if (!response.ok) {
      return {
        turnDetected: false,
        yaw: 0,
        direction: "unknown",
        meetsThreshold: false,
        error: `Service error: ${response.status}`,
      };
    }

    const result = await response.json();

    return {
      turnDetected: result.turnDetected ?? false,
      yaw: result.yaw ?? 0,
      direction: result.direction ?? "unknown",
      meetsThreshold: result.meetsThreshold ?? false,
      error: result.error,
    };
  } catch (error) {
    return {
      turnDetected: false,
      yaw: 0,
      direction: "unknown",
      meetsThreshold: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Multi-Challenge Session API
// ============================================================================

/**
 * Challenge types available for liveness verification.
 */
export type ChallengeType = "smile" | "blink" | "turn_left" | "turn_right";

/**
 * Information about a single challenge.
 */
export interface ChallengeInfo {
  challengeType: ChallengeType;
  index: number;
  total: number;
  title: string;
  instruction: string;
  icon: string;
  timeoutSeconds: number;
}

/**
 * Challenge session state.
 */
export interface ChallengeSession {
  sessionId: string;
  challenges: ChallengeType[];
  currentIndex: number;
  isComplete: boolean;
  isPassed: boolean | null;
  currentChallenge: ChallengeInfo | null;
}

/**
 * Create a new multi-challenge liveness session.
 *
 * Generates a random sequence of 2-4 challenges that must be completed
 * to prove liveness. This prevents replay attacks.
 *
 * @param numChallenges - Number of challenges (2-4, default: 2)
 * @param excludeChallenges - Challenge types to exclude
 * @param requireHeadTurn - Include at least one head turn challenge
 */
export async function createChallengeSession(
  numChallenges: number = 2,
  excludeChallenges?: ChallengeType[],
  requireHeadTurn: boolean = false,
): Promise<ChallengeSession> {
  try {
    const response = await fetch("/api/liveness/challenge/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numChallenges,
        excludeChallenges,
        requireHeadTurn,
      }),
    });

    if (!response.ok) {
      throw new Error(`Service error: ${response.status}`);
    }

    const result = await response.json();

    return {
      sessionId: result.sessionId,
      challenges: result.challenges,
      currentIndex: result.currentIndex,
      isComplete: result.isComplete,
      isPassed: result.isPassed,
      currentChallenge: result.currentChallenge,
    };
  } catch (error) {
    throw new Error(
      `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get current state of a challenge session.
 *
 * @param sessionId - Session ID
 */
export async function getChallengeSession(
  sessionId: string,
): Promise<ChallengeSession> {
  try {
    const response = await fetch(`/api/liveness/challenge/session/${sessionId}`);

    if (!response.ok) {
      throw new Error(`Session not found: ${response.status}`);
    }

    const result = await response.json();

    return {
      sessionId: result.sessionId,
      challenges: result.challenges,
      currentIndex: result.currentIndex,
      isComplete: result.isComplete,
      isPassed: result.isPassed,
      currentChallenge: result.currentChallenge,
    };
  } catch (error) {
    throw new Error(
      `Failed to get session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Result of completing a challenge.
 */
export interface CompleteChallengeResult {
  success: boolean;
  passed: boolean;
  sessionComplete: boolean;
  sessionPassed: boolean | null;
  nextChallenge: ChallengeInfo | null;
  error?: string;
}

/**
 * Mark a challenge as completed in a session.
 *
 * @param sessionId - Session ID
 * @param challengeType - Challenge that was completed
 * @param passed - Whether the challenge passed
 * @param metadata - Optional metadata (scores, etc.)
 */
export async function completeChallengeInSession(
  sessionId: string,
  challengeType: ChallengeType,
  passed: boolean,
  metadata?: Record<string, unknown>,
): Promise<CompleteChallengeResult> {
  try {
    const response = await fetch("/api/liveness/challenge/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        challengeType,
        passed,
        metadata,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        passed: false,
        sessionComplete: false,
        sessionPassed: null,
        nextChallenge: null,
        error: `Service error: ${response.status}`,
      };
    }

    const result = await response.json();

    return {
      success: result.success ?? false,
      passed: result.passed ?? false,
      sessionComplete: result.sessionComplete ?? false,
      sessionPassed: result.sessionPassed,
      nextChallenge: result.nextChallenge,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      passed: false,
      sessionComplete: false,
      sessionPassed: null,
      nextChallenge: null,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Result for a single challenge in batch validation.
 */
export interface ChallengeValidationResult {
  index: number;
  challengeType: ChallengeType;
  passed: boolean;
  score?: number;
  error?: string;
}

/**
 * Multi-challenge batch validation result.
 */
export interface MultiChallengeValidationResult {
  allPassed: boolean;
  totalChallenges: number;
  passedCount: number;
  results: ChallengeValidationResult[];
  processingTimeMs: number;
}

/**
 * Validate multiple challenges at once (batch mode).
 *
 * Alternative to session-based flow. Collects all challenge images
 * and validates them together.
 *
 * @param baselineImage - Base64 baseline image (neutral face)
 * @param challengeResults - Array of {challengeType, image} objects
 */
export async function validateMultipleChallenges(
  baselineImage: string,
  challengeResults: Array<{ challengeType: ChallengeType; image: string }>,
): Promise<MultiChallengeValidationResult> {
  try {
    const response = await fetch("/api/liveness/challenge/validate-multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baselineImage,
        challengeResults: challengeResults.map((r) => ({
          challenge_type: r.challengeType,
          image: r.image,
        })),
      }),
    });

    if (!response.ok) {
      return {
        allPassed: false,
        totalChallenges: challengeResults.length,
        passedCount: 0,
        results: [],
        processingTimeMs: 0,
      };
    }

    const result = await response.json();

    return {
      allPassed: result.allPassed ?? false,
      totalChallenges: result.totalChallenges ?? 0,
      passedCount: result.passedCount ?? 0,
      results: result.results ?? [],
      processingTimeMs: result.processingTimeMs ?? 0,
    };
  } catch (error) {
    return {
      allPassed: false,
      totalChallenges: challengeResults.length,
      passedCount: 0,
      results: [],
      processingTimeMs: 0,
    };
  }
}
