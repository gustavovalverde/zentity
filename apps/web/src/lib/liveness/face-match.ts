/**
 * Face matching utilities for identity verification.
 *
 * This module provides face matching functionality using the internal
 * Human.js-based liveness service.
 */

"use client";

import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/liveness/policy";
import { trpc } from "@/lib/trpc/client";

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
  minConfidence: number = FACE_MATCH_MIN_CONFIDENCE
): Promise<FaceMatchResult> {
  try {
    const result = await trpc.liveness.faceMatch.mutate({
      idImage,
      selfieImage,
      minConfidence,
    });

    return {
      matched: result.matched,
      confidence: result.confidence,
      distance: result.distance,
      threshold: result.threshold,
      processingTimeMs: result.processingTimeMs,
      idFaceExtracted: result.idFaceExtracted,
      idFaceImage: result.idFaceImage,
      error: result.error ?? undefined,
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
