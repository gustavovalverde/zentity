/**
 * Liveness Router
 *
 * Handles multi-gesture liveness detection to verify a real person is present.
 *
 * Flow:
 * 1. createSession: Generates a random challenge sequence (smile, turn_left, turn_right)
 * 2. verify: Validates all challenge responses against baseline
 *    - Smile detection via happy score delta
 *    - Head turn detection via yaw angle change
 *    - Anti-spoofing via real/live scores
 *
 * Also provides standalone faceMatch for ID photo ↔ selfie comparison.
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import z from "zod";
import {
  getEmbeddingVector,
  getFacingDirection,
  getHappyScore,
  getLargestFace,
  getLiveScore,
  getPrimaryFace,
  getRealScore,
  getYawDegrees,
} from "@/lib/human-metrics";
import { detectFromBase64, getHumanServer } from "@/lib/human-server";
import { cropFaceRegion } from "@/lib/image-processing";
import type { ChallengeType } from "@/lib/liveness-challenges";
import {
  BASELINE_CENTERED_THRESHOLD_DEG,
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "@/lib/liveness-policy";
import {
  createLivenessSession,
  getChallengeInfo,
  getLivenessSession,
} from "@/lib/liveness-session-store";
import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/onboarding-session";
import { publicProcedure, router } from "../server";

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
      // Client-provided turn start yaw for turn challenges
      // Server validates delta from this baseline instead of session baseline
      turnStartYaw: z.number().optional(),
    }),
  ),
  debug: z.boolean().optional(),
});

const faceMatchSchema = z.object({
  idImage: z.string().min(1),
  selfieImage: z.string().min(1),
  minConfidence: z.number().min(0).max(1).optional(),
});

export const livenessRouter = router({
  /**
   * Creates a new liveness session with random challenge sequence.
   * Returns session ID and challenge list for the client to complete.
   */
  createSession: publicProcedure
    .input(createSessionSchema.optional())
    .mutation(async ({ input }) => {
      const onboardingSession = await getSessionFromCookie();
      const validation = validateStepAccess(
        onboardingSession,
        "liveness-session",
      );
      if (!validation.valid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: validation.error || "Document verification required first",
        });
      }

      const session = createLivenessSession(
        input?.numChallenges ?? 2,
        input?.requireHeadTurn ?? false,
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
   * Verifies all challenge responses against the baseline image.
   *
   * Checks:
   * - Challenge sequence matches session
   * - Smile challenges: happy score increased from baseline
   * - Turn challenges: yaw angle changed in correct direction
   * - Anti-spoofing: real ≥ 50%, live ≥ 50%
   */
  verify: publicProcedure
    .input(verifySchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();

      const onboardingSession = await getSessionFromCookie();
      const validation = validateStepAccess(
        onboardingSession,
        "liveness-verify",
      );
      if (!validation.valid) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: validation.error || "Document verification required first",
        });
      }

      const debugEnabled =
        input.debug === true ||
        ctx.req.headers.get("x-liveness-debug") === "1" ||
        process.env.LIVENESS_DEBUG === "1" ||
        process.env.NEXT_PUBLIC_LIVENESS_DEBUG === "1";

      const livenessSession = getLivenessSession(input.sessionId);
      if (!livenessSession) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired liveness session",
        });
      }

      const expected = livenessSession.challenges;
      const received = input.challenges.map(
        (c) => c.challengeType as ChallengeType,
      );
      const matches =
        expected.length === received.length &&
        expected.every((c, i) => c === received[i]);
      if (!matches) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Challenge sequence mismatch",
        });
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

      for (const challenge of input.challenges) {
        const res = await detectFromBase64(challenge.image);
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
              `smile: happy ${(happy * 100).toFixed(0)}% Δ${(delta * 100).toFixed(0)}% (req ≥${Math.round(
                SMILE_SCORE_THRESHOLD * 100,
              )}%+Δ≥${Math.round(SMILE_DELTA_THRESHOLD * 100)}% OR ≥${Math.round(
                SMILE_HIGH_THRESHOLD * 100,
              )}%)`,
            );
          }
        } else if (
          challenge.challengeType === "turn_left" ||
          challenge.challengeType === "turn_right"
        ) {
          const yaw = getYawDegrees(face);
          const dir = getFacingDirection(res, face);

          // Use client-provided turn start yaw if available, otherwise fall back to baseline
          // This aligns server validation with what the client detected during the challenge
          const referenceYaw = challenge.turnStartYaw ?? baselineYaw;
          const yawDelta = Math.abs(yaw - referenceYaw);

          // When using client turn start, we trust that client verified centering
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
              `${challenge.challengeType}: yaw ${yaw.toFixed(1)}° ref ${referenceYaw.toFixed(1)}° (baseCentered=${baselineWasCentered ? "yes" : "no"} abs=${yawPassesAbsolute ? "yes" : "no"} delta=${yawPassesDelta ? "yes" : "no"} dir=${turnedCorrectDirection ? "yes" : "no"})`,
            );
          }
        }
      }

      const livenessPassed = baselineReal >= 0.5 && baselineLive >= 0.5;
      if (!livenessPassed) {
        allPassed = false;
        failureReasons.push(
          `anti-spoof: real ${(baselineReal * 100).toFixed(0)}% live ${(baselineLive * 100).toFixed(0)}% (req ≥50%/50%)`,
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

      if (debugEnabled) {
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
   * Compares face embeddings between ID document and selfie.
   * Crops face region from ID for better accuracy.
   * Returns match result with confidence score.
   */
  faceMatch: publicProcedure
    .input(faceMatchSchema)
    .mutation(async ({ input }) => {
      const startTime = Date.now();

      const human = await getHumanServer();
      const minConfidence = input.minConfidence ?? 0.35;

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
        } catch {}
      }

      const selfieResult = await detectFromBase64(input.selfieImage);

      const idFace = getLargestFace(idResult);
      const selfieFace = getLargestFace(selfieResult);

      if (!idFace || !selfieFace) {
        return {
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: minConfidence,
          processingTimeMs: Date.now() - startTime,
          idFaceExtracted: Boolean(idFace),
          idFaceImage: croppedFaceDataUrl ?? undefined,
          error: !idFace
            ? "No face detected in ID document"
            : "No face detected in selfie",
        };
      }

      const idEmb = getEmbeddingVector(idFace);
      const selfieEmb = getEmbeddingVector(selfieFace);

      if (!idEmb || !selfieEmb) {
        return {
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: minConfidence,
          processingTimeMs: Date.now() - startTime,
          idFaceExtracted: true,
          idFaceImage: croppedFaceDataUrl ?? undefined,
          error: !idEmb
            ? "Failed to extract ID face embedding"
            : "Failed to extract selfie face embedding",
        };
      }

      const confidence = human.match.similarity(idEmb, selfieEmb);
      const matched = confidence >= minConfidence;

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
