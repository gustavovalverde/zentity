/**
 * Face Validation Module
 *
 * Handles face detection, anti-spoofing checks, and face matching.
 * Extracted from identity router for single responsibility.
 *
 * Privacy: All processing is server-side via Human.js. No face data
 * is stored - only similarity scores and pass/fail flags.
 */
import "server-only";

import { cropFaceRegion } from "@/lib/document/image-processing";
import {
  getEmbeddingVector,
  getLargestFace,
  getLiveScore,
  getRealScore,
} from "@/lib/liveness/human-metrics";
import { detectFromBase64, getHumanServer } from "@/lib/liveness/human-server";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  FACE_MATCH_MIN_CONFIDENCE,
} from "@/lib/liveness/policy";
import { logger } from "@/lib/logging/logger";

import {
  FaceDetectionError,
  logVerificationError,
} from "./verification-errors";

/**
 * Face bounding box format (can be array or object).
 */
type FaceBox =
  | number[]
  | { x: number; y: number; width: number; height: number };

/**
 * Normalized box format for internal use.
 */
interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Result of face validation including liveness and face match.
 */
export interface FaceValidationResult {
  /** Anti-spoofing score (0-1, higher = more real) */
  antispoofScore: number;
  /** Liveness detection score (0-1, higher = more live) */
  liveScore: number;
  /** Whether liveness checks passed thresholds */
  livenessPassed: boolean;
  /** Face similarity confidence (0-1, higher = more similar) */
  faceMatchConfidence: number;
  /** Whether face match exceeded minimum threshold */
  faceMatchPassed: boolean;
  /** Any issues encountered during validation */
  issues: string[];
}

/**
 * Normalize face box to consistent object format.
 * Handles both array [x, y, width, height] and object formats.
 */
function normalizeBox(box: FaceBox): NormalizedBox {
  if (Array.isArray(box)) {
    return {
      x: box[0] ?? 0,
      y: box[1] ?? 0,
      width: box[2] ?? 0,
      height: box[3] ?? 0,
    };
  }
  return box;
}

/**
 * Attempt to crop face region from document for better detection.
 * Returns null if cropping fails (non-critical - falls back to full image).
 */
async function tryCropDocumentFace(
  documentImage: string,
  box: FaceBox
): Promise<string | null> {
  try {
    const normalizedBox = normalizeBox(box);
    return await cropFaceRegion(documentImage, normalizedBox);
  } catch (error) {
    const cropError = FaceDetectionError.cropFailed(error);
    logVerificationError(cropError, { operation: "crop_document_face" });
    return null;
  }
}

/**
 * Extract liveness scores from a detected face.
 * Returns scores and whether thresholds are met.
 */
function evaluateLiveness(face: ReturnType<typeof getLargestFace>): {
  antispoofScore: number;
  liveScore: number;
  passed: boolean;
} {
  if (!face) {
    return { antispoofScore: 0, liveScore: 0, passed: false };
  }

  const antispoofScore = getRealScore(face);
  const liveScore = getLiveScore(face);
  const passed =
    antispoofScore >= ANTISPOOF_REAL_THRESHOLD &&
    liveScore >= ANTISPOOF_LIVE_THRESHOLD;

  return { antispoofScore, liveScore, passed };
}

/**
 * Compare face embeddings and return similarity score.
 * Returns { confidence, passed } or null if embeddings unavailable.
 */
async function compareFaceEmbeddings(
  selfieFace: ReturnType<typeof getLargestFace>,
  docFace: ReturnType<typeof getLargestFace>
): Promise<{ confidence: number; passed: boolean } | null> {
  if (!(selfieFace && docFace)) {
    return null;
  }

  const selfieEmb = getEmbeddingVector(selfieFace);
  const docEmb = getEmbeddingVector(docFace);

  if (!(selfieEmb && docEmb)) {
    return null;
  }

  const human = await getHumanServer();
  const confidence = human.match.similarity(docEmb, selfieEmb);
  const passed = confidence >= FACE_MATCH_MIN_CONFIDENCE;

  return { confidence, passed };
}

/**
 * Validate faces in selfie and document images.
 *
 * Performs:
 * 1. Face detection on both images (parallel)
 * 2. Optional face cropping from document for better detection
 * 3. Anti-spoofing/liveness checks on selfie
 * 4. Face embedding comparison for identity match
 *
 * @param selfieImage - Base64 selfie image
 * @param documentImage - Base64 document image
 * @returns Validation results with scores and issues
 */
export async function validateFaces(
  selfieImage: string,
  documentImage: string
): Promise<FaceValidationResult> {
  const issues: string[] = [];

  let antispoofScore = 0;
  let liveScore = 0;
  let livenessPassed = false;
  let faceMatchConfidence = 0;
  let faceMatchPassed = false;

  try {
    // Parallelize independent face detections (~100-200ms improvement)
    const [selfieResult, docResultInitial] = await Promise.all([
      detectFromBase64(selfieImage),
      detectFromBase64(documentImage),
    ]);

    const selfieFace = getLargestFace(selfieResult);
    const docFaceInitial = getLargestFace(docResultInitial);

    // Try to improve document face detection by cropping
    let docResult = docResultInitial;
    if (docFaceInitial?.box) {
      const croppedImage = await tryCropDocumentFace(
        documentImage,
        docFaceInitial.box
      );
      if (croppedImage) {
        docResult = await detectFromBase64(croppedImage);
      }
    }

    const docFace = getLargestFace(docResult);

    // Evaluate selfie liveness
    if (selfieFace) {
      const livenessResult = evaluateLiveness(selfieFace);
      antispoofScore = livenessResult.antispoofScore;
      liveScore = livenessResult.liveScore;
      livenessPassed = livenessResult.passed;
    } else {
      issues.push("no_selfie_face");
      logger.warn(
        { operation: "face_validation" },
        "No face detected in selfie"
      );
    }

    // Compare faces
    if (!docFace) {
      issues.push("no_document_face");
      logger.warn(
        { operation: "face_validation" },
        "No face detected in document"
      );
    } else if (selfieFace) {
      const matchResult = await compareFaceEmbeddings(selfieFace, docFace);
      if (matchResult) {
        faceMatchConfidence = matchResult.confidence;
        faceMatchPassed = matchResult.passed;
      } else {
        issues.push("embedding_failed");
        logger.warn(
          { operation: "face_validation" },
          "Failed to compute face embeddings"
        );
      }
    }
  } catch (error) {
    const serviceError = FaceDetectionError.serviceFailed(error);
    logVerificationError(serviceError, { operation: "face_validation" });
    issues.push(serviceError.issueCode);
  }

  return {
    antispoofScore,
    liveScore,
    livenessPassed,
    faceMatchConfidence,
    faceMatchPassed,
    issues,
  };
}
