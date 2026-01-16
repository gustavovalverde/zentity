"use client";

import type { FaceMatchStatus } from "@/components/onboarding/face-verification-card";

import { useEffect, useRef, useState } from "react";

import { type FaceMatchResult, matchFaces } from "@/lib/liveness/face-match";

/**
 * Result from the useFaceMatch hook.
 */
export interface UseFaceMatchResult {
  /** Current status of the face matching operation */
  status: FaceMatchStatus;
  /** Face match result with confidence, distance, and extracted face images */
  result: FaceMatchResult | null;
}

/**
 * Hook to manage face matching between an ID document and a selfie.
 *
 * Automatically triggers face matching when both images are available.
 * Only attempts matching once to avoid repeated calls.
 *
 * @param idDocumentBase64 - Base64 encoded ID document image
 * @param selfieImage - Base64 encoded selfie image (can be best frame from liveness)
 *
 * @example
 * ```tsx
 * const { status, result } = useFaceMatch(store.idDocumentBase64, selfieImage);
 *
 * if (status === "matching") {
 *   return <Spinner />;
 * }
 *
 * if (status === "matched") {
 *   return <Badge>Match: {Math.round(result.confidence * 100)}%</Badge>;
 * }
 * ```
 */
export function useFaceMatch(
  idDocumentBase64: string | null,
  selfieImage: string | null
): UseFaceMatchResult {
  const [status, setStatus] = useState<FaceMatchStatus>("idle");
  const [result, setResult] = useState<FaceMatchResult | null>(null);
  const attemptedRef = useRef(false);

  // Use refs for large base64 strings to avoid expensive string comparisons
  // in effect dependencies (rerender-dependencies optimization)
  const idDocRef = useRef(idDocumentBase64);
  const selfieRef = useRef(selfieImage);
  idDocRef.current = idDocumentBase64;
  selfieRef.current = selfieImage;

  // Derive a primitive boolean for the effect dependency
  const hasImages = Boolean(idDocumentBase64 && selfieImage);

  useEffect(() => {
    // Only attempt once
    if (attemptedRef.current) {
      return;
    }

    // Need both images (checked via primitive boolean)
    if (!hasImages) {
      return;
    }

    // Only trigger from idle state
    if (status !== "idle") {
      return;
    }

    attemptedRef.current = true;

    const performFaceMatch = async () => {
      // Read current values from refs
      const idDoc = idDocRef.current;
      const selfie = selfieRef.current;

      // Double-check images still exist
      if (!(idDoc && selfie)) {
        return;
      }

      setStatus("matching");

      try {
        const matchResult = await matchFaces(idDoc, selfie);
        setResult(matchResult);

        if (matchResult.error) {
          setStatus("error");
        } else if (matchResult.matched) {
          setStatus("matched");
        } else {
          setStatus("no_match");
        }
      } catch (err) {
        setStatus("error");
        setResult({
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: 0.6,
          processingTimeMs: 0,
          idFaceExtracted: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    };

    performFaceMatch();
  }, [hasImages, status]); // Primitive dependencies only

  return { status, result };
}
