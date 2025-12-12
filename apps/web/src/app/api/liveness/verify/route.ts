import { type NextRequest, NextResponse } from "next/server";
import {
  getEmbeddingVector,
  getFacingDirection,
  getHappyScore,
  getLiveScore,
  getPrimaryFace,
  getRealScore,
  getYawDegrees,
} from "@/lib/human-metrics";
import { detectFromBase64 } from "@/lib/human-server";
import type { ChallengeType } from "@/lib/liveness-challenges";
import {
  BASELINE_CENTERED_THRESHOLD_DEG,
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "@/lib/liveness-policy";
import { getLivenessSession } from "@/lib/liveness-session-store";
import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/onboarding-session";

export const runtime = "nodejs";

interface VerifyRequest {
  sessionId: string; // REQUIRED - no longer optional
  baselineImage: string;
  challenges: Array<{ challengeType: ChallengeType; image: string }>;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  try {
    // Validate onboarding session - must have completed step 2 (document upload)
    const onboardingSession = await getSessionFromCookie();
    const validation = validateStepAccess(onboardingSession, "liveness-verify");
    if (!validation.valid) {
      return NextResponse.json(
        {
          verified: false,
          error: validation.error || "Document verification required first",
        },
        { status: 403 },
      );
    }

    const body = (await request.json()) as VerifyRequest;
    if (!body.baselineImage || !Array.isArray(body.challenges)) {
      return NextResponse.json(
        { verified: false, error: "Invalid request" },
        { status: 400 },
      );
    }

    // sessionId is now REQUIRED (security fix)
    if (!body.sessionId) {
      return NextResponse.json(
        { verified: false, error: "Session ID is required" },
        { status: 400 },
      );
    }

    const livenessSession = getLivenessSession(body.sessionId);
    if (!livenessSession) {
      return NextResponse.json(
        { verified: false, error: "Invalid or expired liveness session" },
        { status: 400 },
      );
    }

    // Validate challenge sequence matches what was assigned
    const expected = livenessSession.challenges;
    const received = body.challenges.map((c) => c.challengeType);
    const matches =
      expected.length === received.length &&
      expected.every((c, i) => c === received[i]);
    if (!matches) {
      return NextResponse.json(
        {
          verified: false,
          error: "Challenge sequence mismatch",
        },
        { status: 400 },
      );
    }

    // Baseline analysis
    const baselineResult = await detectFromBase64(body.baselineImage);
    const baselineFace = getPrimaryFace(baselineResult);
    if (!baselineFace) {
      return NextResponse.json({
        verified: false,
        error: "No face detected in baseline",
        processingTimeMs: Date.now() - start,
      });
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
    for (const challenge of body.challenges) {
      const res = await detectFromBase64(challenge.image);
      const face = getPrimaryFace(res);
      if (!face) {
        results.push({
          challengeType: challenge.challengeType,
          passed: false,
          error: "No face detected",
        });
        allPassed = false;
        continue;
      }

      if (challenge.challengeType === "smile") {
        const happy = getHappyScore(face);
        const delta = happy - baselineHappy;
        // Pass conditions (stricter to prevent false positives):
        // 1. Standard: happy >= 60% AND delta >= 10% (must smile noticeably more than baseline)
        // 2. Very high: happy >= 85% (clearly smiling - this is a real smile)
        const passed =
          (happy >= SMILE_SCORE_THRESHOLD && delta >= SMILE_DELTA_THRESHOLD) ||
          happy >= SMILE_HIGH_THRESHOLD;
        results.push({
          challengeType: "smile",
          passed,
          score: happy,
        });
        if (!passed) allPassed = false;
      } else if (
        challenge.challengeType === "turn_left" ||
        challenge.challengeType === "turn_right"
      ) {
        const yaw = getYawDegrees(face);
        const dir = getFacingDirection(res, face);
        const yawDelta = Math.abs(yaw - baselineYaw);
        // Requirements:
        // 1. Baseline must have been relatively centered (within ±10°)
        // 2. Either: final yaw exceeds absolute threshold (±18°)
        //    OR: moved at least 20° from baseline (significant movement)
        // 3. Direction must be correct (turned the right way)
        const baselineWasCentered =
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
            ? yaw < baselineYaw
            : yaw > baselineYaw;
        const passed =
          baselineWasCentered &&
          turnedCorrectDirection &&
          (yawPassesAbsolute || yawPassesDelta);
        results.push({
          challengeType: challenge.challengeType,
          passed,
          direction: dir,
          yaw,
        });
        if (!passed) allPassed = false;
      }
    }

    const livenessPassed = baselineReal >= 0.5 && baselineLive >= 0.5;
    if (!livenessPassed) {
      allPassed = false;
    }

    const embedding = getEmbeddingVector(baselineFace);

    // Final summary log
    const _challengesPassed = results.every((r) => r.passed);

    return NextResponse.json({
      verified: allPassed,
      livenessPassed,
      baseline: {
        realScore: baselineReal,
        liveScore: baselineLive,
        happyScore: baselineHappy,
      },
      results,
      embedding,
      processingTimeMs: Date.now() - start,
    });
  } catch (error) {
    return NextResponse.json(
      {
        verified: false,
        error: error instanceof Error ? error.message : String(error),
        processingTimeMs: Date.now() - start,
      },
      { status: 500 },
    );
  }
}
