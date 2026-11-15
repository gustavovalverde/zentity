/**
 * Liveness Router
 *
 * Face match for authenticated users (post-sign-up dashboard verification).
 *
 * Security: face match results are written directly to the identity draft by
 * the server, never accepted from client-provided "pre-validated" results, and
 * only after the submitted selfie hashes to the draft's verifiedSelfieHash.
 *
 * The gesture liveness flow (frame streaming + scoring) is server-authoritative
 * and lives outside this router; it writes antispoofScore/liveScore/
 * verifiedSelfieHash to the draft, which faceMatch then binds against.
 */
import "server-only";

import z from "zod";

import {
  getIdentityDraftById,
  updateIdentityDraft,
} from "@/lib/db/queries/identity";
import { createRateLimiter } from "@/lib/http/rate-limit";
import { cropFaceRegion } from "@/lib/identity/document/image-processing";
import {
  detectFromBase64,
  getHumanServer,
} from "@/lib/identity/liveness/human/server";
import { hashSelfie } from "@/lib/identity/liveness/session";
import { FACE_MATCH_MIN_CONFIDENCE } from "@/lib/identity/liveness/thresholds";

import { rateLimitedProcedure, router } from "../server";

const faceMatchSchema = z.object({
  idImage: z.string().min(1),
  selfieImage: z.string().min(1),
  minConfidence: z.number().min(0).max(1).optional(),
  /** Identity draft ID - when provided, results are written directly to DB */
  draftId: z.string().min(1).optional(),
});

const livenessLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

const livenessProcedure = rateLimitedProcedure(livenessLimiter);

export const livenessRouter = router({
  /**
   * Face matching for dashboard verification.
   * When draftId is provided, results are written directly to the database.
   * This is the secure path - server validates and writes, not client.
   */
  matchFace: livenessProcedure
    .input(faceMatchSchema)
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      const userId = ctx.session.user.id;
      const minConfidence = input.minConfidence ?? FACE_MATCH_MIN_CONFIDENCE;

      // Validate draft ownership and selfie binding before any expensive work
      if (input.draftId) {
        const draft = await getIdentityDraftById(input.draftId);
        if (!draft) {
          return {
            matched: false,
            confidence: 0,
            distance: 1,
            threshold: minConfidence,
            processingTimeMs: Date.now() - startTime,
            idFaceExtracted: false,
            error: "Identity draft not found",
          };
        }
        if (draft.userId !== userId) {
          return {
            matched: false,
            confidence: 0,
            distance: 1,
            threshold: minConfidence,
            processingTimeMs: Date.now() - startTime,
            idFaceExtracted: false,
            error: "Draft does not belong to this user",
          };
        }
        if (!draft.verifiedSelfieHash) {
          return {
            matched: false,
            confidence: 0,
            distance: 1,
            threshold: minConfidence,
            processingTimeMs: Date.now() - startTime,
            idFaceExtracted: false,
            error: "Liveness not completed for this draft",
          };
        }
        const selfieHash = hashSelfie(input.selfieImage);
        if (selfieHash !== draft.verifiedSelfieHash) {
          return {
            matched: false,
            confidence: 0,
            distance: 1,
            threshold: minConfidence,
            processingTimeMs: Date.now() - startTime,
            idFaceExtracted: false,
            error: "Selfie does not match liveness session",
          };
        }
      }

      const human = await getHumanServer();

      const idResultInitial = await detectFromBase64(input.idImage);
      const idFaceInitial = idResultInitial.face[0];

      let idResult = idResultInitial;
      let croppedFaceDataUrl: string | null = null;

      if (idFaceInitial) {
        try {
          croppedFaceDataUrl = await cropFaceRegion(
            input.idImage,
            idFaceInitial.box
          );
          idResult = await detectFromBase64(croppedFaceDataUrl);
        } catch {
          /* Crop failed, fallback to initial detection result */
        }
      }

      const selfieResult = await detectFromBase64(input.selfieImage);

      const idFace = idResult.face[0];
      const selfieFace = selfieResult.face[0];

      if (!(idFace && selfieFace)) {
        return {
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: minConfidence,
          processingTimeMs: Date.now() - startTime,
          idFaceExtracted: Boolean(idFace),
          idFaceImage: croppedFaceDataUrl ?? undefined,
          error: idFace
            ? "No face detected in selfie"
            : "No face detected in ID document",
        };
      }

      const idEmb = idFace.embedding;
      const selfieEmb = selfieFace.embedding;

      if (!(idEmb && selfieEmb)) {
        return {
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: minConfidence,
          processingTimeMs: Date.now() - startTime,
          idFaceExtracted: true,
          idFaceImage: croppedFaceDataUrl ?? undefined,
          error: idEmb
            ? "Failed to extract selfie face embedding"
            : "Failed to extract ID face embedding",
        };
      }

      const confidence = human.match.similarity(idEmb, selfieEmb);
      const matched = confidence >= minConfidence;

      // Write face match results directly to database if draftId provided
      // This is the secure path - server writes results, not client
      if (input.draftId) {
        await updateIdentityDraft(input.draftId, {
          userId,
          faceMatchConfidence: confidence,
        });
      }

      return {
        matched,
        confidence,
        distance: 1 - confidence,
        threshold: minConfidence,
        processingTimeMs: Date.now() - startTime,
        idFaceExtracted: true,
        idFaceImage: croppedFaceDataUrl ?? undefined,
        error: null,
      };
    }),
});
