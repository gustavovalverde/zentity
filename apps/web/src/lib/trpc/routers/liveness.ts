/**
 * Liveness Router
 *
 * Liveness verification for authenticated users (post-sign-up).
 *
 * Security: Face match results are written directly to the identity draft
 * by the server - never accepted from client-provided "pre-validated" results.
 */
import "server-only";

import type { ChallengeType } from "@/lib/identity/liveness/challenges";

import z from "zod";

import {
  getIdentityDraftById,
  updateIdentityDraft,
} from "@/lib/db/queries/identity";
import { cropFaceRegion } from "@/lib/identity/document/image-processing";
import {
  getEmbeddingVector,
  getFacingDirection,
  getHappyScore,
  getLargestFace,
  getLiveScore,
  getPrimaryFace,
  getRealScore,
  getYawDegrees,
} from "@/lib/identity/liveness/human-metrics";
import {
  detectFromBase64,
  getHumanServer,
} from "@/lib/identity/liveness/human-server";
import {
  createLivenessSession,
  getChallengeInfo,
  getLivenessSession,
} from "@/lib/identity/liveness/liveness-session-store";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  BASELINE_CENTERED_THRESHOLD_DEG,
  FACE_MATCH_MIN_CONFIDENCE,
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "@/lib/identity/liveness/policy";

import { protectedProcedure, router } from "../server";

const challengeTypeSchema = z.enum(["smile", "turn_left", "turn_right"]);

const createSessionSchema = z.object({
  numChallenges: z.number().int().min(1).max(4).optional(),
  requireHeadTurn: z.boolean().optional(),
});

const verifySchema = z.object({
  sessionId: z.string().min(1),
  baselineImage: z.string().min(1),
  challenges: z.array(
    z.object({
      challengeType: challengeTypeSchema,
      image: z.string().min(1),
      turnStartYaw: z.number().optional(),
    })
  ),
});

const faceMatchSchema = z.object({
  idImage: z.string().min(1),
  selfieImage: z.string().min(1),
  minConfidence: z.number().min(0).max(1).optional(),
  /** Identity draft ID - when provided, results are written directly to DB */
  draftId: z.string().min(1).optional(),
});

export const livenessRouter = router({
  /**
   * Creates a new liveness session for dashboard verification.
   * Requires authenticated user.
   */
  createSession: protectedProcedure
    .input(createSessionSchema.optional())
    .mutation(({ input }) => {
      const session = createLivenessSession(
        input?.numChallenges ?? 2,
        input?.requireHeadTurn ?? false
      );

      const currentChallenge = getChallengeInfo(session);

      return {
        sessionId: session.sessionId,
        challenges: session.challenges,
        currentIndex: session.currentIndex,
        isComplete: false,
        isPassed: null,
        currentChallenge,
      };
    }),

  /**
   * Verifies liveness challenges for dashboard users.
   * Requires authenticated user.
   */
  verify: protectedProcedure
    .input(verifySchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();

      const livenessSession = getLivenessSession(input.sessionId);
      if (!livenessSession) {
        return {
          verified: false,
          error: "Invalid or expired liveness session",
          processingTimeMs: Date.now() - start,
        };
      }

      const expected = livenessSession.challenges;
      const received = input.challenges.map(
        (c) => c.challengeType as ChallengeType
      );
      const matches =
        expected.length === received.length &&
        expected.every((c, i) => c === received[i]);
      if (!matches) {
        return {
          verified: false,
          error: "Challenge sequence mismatch",
          processingTimeMs: Date.now() - start,
        };
      }

      const baselineResult = await detectFromBase64(input.baselineImage);
      const baselineFace = getPrimaryFace(baselineResult);
      if (!baselineFace) {
        return {
          verified: false,
          error: "No face detected in baseline",
          processingTimeMs: Date.now() - start,
        };
      }

      const baselineHappy = getHappyScore(baselineFace);
      const baselineReal = getRealScore(baselineFace);
      const baselineLive = getLiveScore(baselineFace);
      const baselineYaw = getYawDegrees(baselineFace);

      if (ctx.debug) {
        ctx.log.debug(
          {
            stage: "baseline",
            faceDetected: true,
            challengeCount: input.challenges.length,
          },
          "Dashboard liveness baseline processed"
        );
      }

      const detectionResults = await Promise.all(
        input.challenges.map((challenge) => detectFromBase64(challenge.image))
      );

      const results: Array<{
        challengeType: ChallengeType;
        passed: boolean;
        score?: number;
        direction?: string;
        yaw?: number;
        error?: string;
      }> = [];

      let allPassed = true;
      const failureReasons: string[] = [];

      for (const [index, challenge] of input.challenges.entries()) {
        const res = detectionResults[index];
        const face = getPrimaryFace(res);
        if (!face) {
          results.push({
            challengeType: challenge.challengeType as ChallengeType,
            passed: false,
            error: "No face detected",
          });
          allPassed = false;
          failureReasons.push(`${challenge.challengeType}: no face detected`);
          continue;
        }

        if (ctx.debug) {
          ctx.log.debug(
            {
              stage: "challenge",
              challengeType: challenge.challengeType,
              index,
              faceDetected: true,
            },
            "Dashboard liveness challenge processed"
          );
        }

        if (challenge.challengeType === "smile") {
          const happy = getHappyScore(face);
          const delta = happy - baselineHappy;
          const passed =
            (happy >= SMILE_SCORE_THRESHOLD &&
              delta >= SMILE_DELTA_THRESHOLD) ||
            happy >= SMILE_HIGH_THRESHOLD;

          results.push({
            challengeType: "smile",
            passed,
            score: happy,
          });

          if (!passed) {
            allPassed = false;
            failureReasons.push(
              `smile: happy ${(happy * 100).toFixed(0)}% Δ${(delta * 100).toFixed(0)}%`
            );
          }
        } else if (
          challenge.challengeType === "turn_left" ||
          challenge.challengeType === "turn_right"
        ) {
          const yaw = getYawDegrees(face);
          const dir = getFacingDirection(res, face);

          const referenceYaw = challenge.turnStartYaw ?? baselineYaw;
          const yawDelta = Math.abs(yaw - referenceYaw);

          const baselineWasCentered =
            challenge.turnStartYaw !== undefined ||
            Math.abs(baselineYaw) <= BASELINE_CENTERED_THRESHOLD_DEG;
          const yawThreshold = TURN_YAW_ABSOLUTE_THRESHOLD_DEG;
          const significantMovement = TURN_YAW_SIGNIFICANT_DELTA_DEG;

          const yawPassesAbsolute =
            challenge.challengeType === "turn_left"
              ? yaw < -yawThreshold
              : yaw > yawThreshold;
          const yawPassesDelta = yawDelta >= significantMovement;
          const turnedCorrectDirection =
            challenge.challengeType === "turn_left"
              ? yaw < referenceYaw
              : yaw > referenceYaw;

          const passed =
            baselineWasCentered &&
            turnedCorrectDirection &&
            (yawPassesAbsolute || yawPassesDelta);

          results.push({
            challengeType: challenge.challengeType as ChallengeType,
            passed,
            direction: dir,
            yaw,
          });

          if (!passed) {
            allPassed = false;
            failureReasons.push(
              `${challenge.challengeType}: yaw ${yaw.toFixed(1)}° ref ${referenceYaw.toFixed(1)}°`
            );
          }
        }
      }

      const livenessPassed =
        baselineReal >= ANTISPOOF_REAL_THRESHOLD &&
        baselineLive >= ANTISPOOF_LIVE_THRESHOLD;
      if (!livenessPassed) {
        allPassed = false;
        failureReasons.push(
          `anti-spoof: real ${(baselineReal * 100).toFixed(0)}% live ${(baselineLive * 100).toFixed(0)}%`
        );
      }

      const error = allPassed
        ? undefined
        : failureReasons[0] || "Verification failed";

      const response: Record<string, unknown> = {
        verified: allPassed,
        livenessPassed,
        error,
        processingTimeMs: Date.now() - start,
      };

      if (ctx.debug) {
        response.debug = {
          baseline: {
            realScore: baselineReal,
            liveScore: baselineLive,
            happyScore: baselineHappy,
            yawDeg: baselineYaw,
          },
          results,
          failureReasons,
          embedding: getEmbeddingVector(baselineFace),
          totalTimeMs: Date.now() - start,
        };
      }

      return response;
    }),

  /**
   * Face matching for dashboard verification.
   * When draftId is provided, results are written directly to the database.
   * This is the secure path - server validates and writes, not client.
   */
  faceMatch: protectedProcedure
    .input(faceMatchSchema)
    .mutation(async ({ ctx, input }) => {
      const startTime = Date.now();
      const userId = ctx.session.user.id;

      const human = await getHumanServer();
      const minConfidence = input.minConfidence ?? FACE_MATCH_MIN_CONFIDENCE;

      // Validate draft ownership if draftId provided
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
      }

      const idResultInitial = await detectFromBase64(input.idImage);
      const idFaceInitial = getLargestFace(idResultInitial);

      let idResult = idResultInitial;
      let croppedFaceDataUrl: string | null = null;

      if (idFaceInitial?.box) {
        try {
          const box = Array.isArray(idFaceInitial.box)
            ? {
                x: idFaceInitial.box[0],
                y: idFaceInitial.box[1],
                width: idFaceInitial.box[2],
                height: idFaceInitial.box[3],
              }
            : idFaceInitial.box;

          croppedFaceDataUrl = await cropFaceRegion(input.idImage, box);
          idResult = await detectFromBase64(croppedFaceDataUrl);
        } catch {
          /* Crop failed, fallback to initial detection result */
        }
      }

      const selfieResult = await detectFromBase64(input.selfieImage);

      const idFace = getLargestFace(idResult);
      const selfieFace = getLargestFace(selfieResult);

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

      const idEmb = getEmbeddingVector(idFace);
      const selfieEmb = getEmbeddingVector(selfieFace);

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
          faceMatchPassed: matched,
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
