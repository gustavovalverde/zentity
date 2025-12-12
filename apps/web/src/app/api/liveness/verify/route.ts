import { type NextRequest, NextResponse } from "next/server";
import { detectFromBase64 } from "@/lib/human-server";
import type { ChallengeType } from "@/lib/liveness-challenges";
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

function getPrimaryFace(result: any) {
  return result?.face?.[0] ?? null;
}

function getHappyScore(face: any): number {
  const emo = face?.emotion;
  if (!emo) return 0;
  if (Array.isArray(emo)) {
    const happy = emo.find(
      (e) => e?.emotion === "happy" || e?.emotion === "Happy",
    );
    return happy?.score ?? 0;
  }
  if (typeof emo === "object") {
    if (typeof emo.happy === "number") return emo.happy;
    if (emo.emotion && (emo.emotion === "happy" || emo.emotion === "Happy")) {
      return typeof emo.score === "number" ? emo.score : 0;
    }
  }
  return 0;
}

function getRealScore(face: any): number {
  const val = face?.real ?? face?.antispoof?.real ?? face?.antispoof?.score;
  return typeof val === "number" ? val : 0;
}

function getLiveScore(face: any): number {
  const val = face?.live ?? face?.liveness?.live ?? face?.liveness?.score;
  return typeof val === "number" ? val : 0;
}

function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function getYaw(face: any): number {
  const yawRad = face?.rotation?.angle?.yaw;
  if (typeof yawRad === "number") return radToDeg(yawRad);
  const yaw = face?.rotation?.yaw ?? face?.angle?.yaw;
  return typeof yaw === "number" ? yaw : 0;
}

function getFacingDirection(
  result: any,
  face: any,
): "left" | "right" | "center" {
  const gestures = result?.gesture;
  if (Array.isArray(gestures)) {
    for (const g of gestures) {
      const name = g?.gesture ?? g?.name ?? "";
      if (typeof name === "string" && name.startsWith("facing")) {
        if (name.includes("left")) return "left";
        if (name.includes("right")) return "right";
        return "center";
      }
    }
  }

  const yaw = getYaw(face);
  if (yaw < -10) return "left";
  if (yaw > 10) return "right";
  return "center";
}

function getEmbedding(face: any): number[] | null {
  const emb =
    face?.embedding ??
    face?.descriptor ??
    face?.description?.embedding ??
    face?.description;
  if (!emb) return null;
  if (Array.isArray(emb)) return emb.map((n) => Number(n));
  if (emb instanceof Float32Array) return Array.from(emb);
  if (typeof emb === "object" && Array.isArray(emb.data)) {
    return emb.data.map((n: any) => Number(n));
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  try {
    // Validate onboarding session - must have completed step 2 (document upload)
    const onboardingSession = await getSessionFromCookie();
    const validation = validateStepAccess(onboardingSession, "liveness-verify");
    if (!validation.valid) {
      return NextResponse.json(
        { verified: false, error: validation.error || "Document verification required first" },
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
      console.log("[liveness/verify] 400: Missing sessionId");
      return NextResponse.json(
        { verified: false, error: "Session ID is required" },
        { status: 400 },
      );
    }

    const livenessSession = getLivenessSession(body.sessionId);
    if (!livenessSession) {
      console.log("[liveness/verify] 400: Session not found:", body.sessionId);
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
      console.log("[liveness/verify] 400: Challenge mismatch", { expected, received });
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
      console.log("[liveness/verify] No face detected in baseline image");
      return NextResponse.json({
        verified: false,
        error: "No face detected in baseline",
        processingTimeMs: Date.now() - start,
      });
    }

    const baselineHappy = getHappyScore(baselineFace);
    const baselineReal = getRealScore(baselineFace);
    const baselineLive = getLiveScore(baselineFace);
    const baselineYaw = getYaw(baselineFace);

    console.log("[liveness/verify] Baseline scores:", {
      happy: baselineHappy.toFixed(3),
      real: baselineReal.toFixed(3),
      live: baselineLive.toFixed(3),
      yaw: baselineYaw.toFixed(1),
      thresholds: { real: 0.5, live: 0.5 },
    });

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
        console.log(`[liveness/verify] ${challenge.challengeType}: No face detected in image`);
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
        const passed = (happy >= 0.6 && delta >= 0.1) || happy >= 0.85;
        console.log("[liveness/verify] Smile challenge:", {
          happy: happy.toFixed(3),
          baseline: baselineHappy.toFixed(3),
          delta: delta.toFixed(3),
          passed,
          thresholds: { happy: 0.6, delta: 0.1, highHappy: 0.85 },
          reason: !passed
            ? happy < 0.6
              ? `happy ${happy.toFixed(2)} < 0.6`
              : `delta ${delta.toFixed(2)} < 0.10 AND happy ${happy.toFixed(2)} < 0.85`
            : "OK",
        });
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
        const yaw = getYaw(face);
        const dir = getFacingDirection(res, face);
        const yawDelta = Math.abs(yaw - baselineYaw);
        // Requirements:
        // 1. Baseline must have been relatively centered (within ±10°)
        // 2. Either: final yaw exceeds absolute threshold (±18°)
        //    OR: moved at least 20° from baseline (significant movement)
        // 3. Direction must be correct (turned the right way)
        const baselineWasCentered = Math.abs(baselineYaw) <= 10;
        const yawThreshold = 18;
        const significantMovement = 20;
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
        console.log(`[liveness/verify] ${challenge.challengeType} challenge:`, {
          yaw: yaw.toFixed(1),
          baselineYaw: baselineYaw.toFixed(1),
          yawDelta: yawDelta.toFixed(1),
          direction: dir,
          baselineWasCentered,
          yawPassesAbsolute,
          yawPassesDelta,
          turnedCorrectDirection,
          passed,
          thresholds: {
            absolute: challenge.challengeType === "turn_left" ? `< -${yawThreshold}°` : `> ${yawThreshold}°`,
            delta: `>= ${significantMovement}°`,
            baselineCentered: "±10°",
          },
          reason: !passed
            ? !baselineWasCentered
              ? `baseline yaw ${baselineYaw.toFixed(1)}° not centered (need ±10°)`
              : !turnedCorrectDirection
                ? `turned wrong direction`
                : `yaw ${yaw.toFixed(1)}° didn't reach ±${yawThreshold}° AND delta ${yawDelta.toFixed(1)}° < ${significantMovement}°`
            : "OK",
        });
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

    const embedding = getEmbedding(baselineFace);

    // Final summary log
    const challengesPassed = results.every((r) => r.passed);
    console.log("[liveness/verify] === FINAL RESULT ===", {
      verified: allPassed,
      livenessPassed,
      challengesPassed,
      livenessReason: !livenessPassed
        ? baselineReal < 0.5
          ? `realScore ${baselineReal.toFixed(2)} < 0.5`
          : `liveScore ${baselineLive.toFixed(2)} < 0.5`
        : "OK",
      failedChallenges: results.filter((r) => !r.passed).map((r) => r.challengeType),
      processingTimeMs: Date.now() - start,
    });

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
