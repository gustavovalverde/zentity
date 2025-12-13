/**
 * Face matching utilities for KYC verification.
 *
 * This module provides face matching functionality using the internal
 * Human.js-based liveness service.
 */

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
 * @param minConfidence - Minimum confidence threshold (0.0-1.0, default: 0.35 for ID-to-selfie)
 * @returns Face matching result
 */
export async function matchFaces(
  idImage: string,
  selfieImage: string,
  minConfidence: number = 0.35,
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
