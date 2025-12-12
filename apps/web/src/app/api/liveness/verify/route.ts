import { type NextRequest, NextResponse } from "next/server";
import { detectFromBase64 } from "@/lib/human-server";
import type { ChallengeType } from "@/lib/liveness-challenges";
import { getLivenessSession } from "@/lib/liveness-session-store";
import {
  getSessionFromCookie,
  validateStepAccess,
} from "@/lib/onboarding-session";
import type { EmbeddingData } from "@/types/human";

export const runtime = "nodejs";

interface VerifyRequest {
  sessionId: string; // REQUIRED - no longer optional
  baselineImage: string;
  challenges: Array<{ challengeType: ChallengeType; image: string }>;
}

// Face result type for Human.js - using permissive types
interface FaceResult {
  emotion?:
    | Array<{ score: number; emotion: string }>
    | { happy?: number }
    | null;
  real?: number | null;
  live?: number | null;
  liveness?: { live?: number; score?: number } | null;
  antispoof?: { real?: number; score?: number } | null;
  rotation?: {
    angle?: { yaw?: number; pitch?: number; roll?: number } | null;
  } | null;
  angle?: { yaw?: number } | null;
  embedding?: EmbeddingData;
  descriptor?: EmbeddingData;
  description?: { embedding?: EmbeddingData } | EmbeddingData | null;
}

// Detection result from Human.js
interface DetectionResult {
  face?: FaceResult[] | null;
  gesture?: Array<{ gesture?: string; name?: string }> | null;
}

function getPrimaryFace(result: unknown): FaceResult | null {
  const res = result as DetectionResult | null;
  return res?.face?.[0] ?? null;
}

function getHappyScore(face: FaceResult | null): number {
  const emo = face?.emotion;
  if (!emo) return 0;
  // Human.js returns emotion as array: [{ score, emotion }]
  if (Array.isArray(emo)) {
    const happy = emo.find(
      (e) => e?.emotion === "happy" || e?.emotion === "Happy",
    );
    return happy?.score ?? 0;
  }
  // Some versions may return object format with happy property
  if (typeof emo === "object" && "happy" in emo) {
    const happyVal = (emo as { happy?: number }).happy;
    if (typeof happyVal === "number") return happyVal;
  }
  return 0;
}

function getRealScore(face: FaceResult | null): number {
  const val = face?.real ?? face?.antispoof?.real ?? face?.antispoof?.score;
  return typeof val === "number" ? val : 0;
}

function getLiveScore(face: FaceResult | null): number {
  const val = face?.live ?? face?.liveness?.live ?? face?.liveness?.score;
  return typeof val === "number" ? val : 0;
}

function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function getYaw(face: FaceResult | null): number {
  const yawRad = face?.rotation?.angle?.yaw;
  if (typeof yawRad === "number") return radToDeg(yawRad);
  const yaw = face?.angle?.yaw;
  return typeof yaw === "number" ? yaw : 0;
}

function getFacingDirection(
  result: unknown,
  face: FaceResult | null,
): "left" | "right" | "center" {
  const res = result as DetectionResult | null;
  const gestures = res?.gesture;
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

function getEmbedding(face: FaceResult | null): number[] | null {
  const emb: EmbeddingData =
    face?.embedding ??
    face?.descriptor ??
    (face?.description &&
    typeof face.description === "object" &&
    "embedding" in face.description
      ? face.description.embedding
      : (face?.description as EmbeddingData));
  if (!emb) return null;
  if (Array.isArray(emb)) return emb.map((n) => Number(n));
  if (emb instanceof Float32Array) return Array.from(emb);
  if (typeof emb === "object" && "data" in emb && Array.isArray(emb.data)) {
    return emb.data.map((n: number) => Number(n));
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
    const baselineYaw = getYaw(baselineFace);

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
        const passed = (happy >= 0.6 && delta >= 0.1) || happy >= 0.85;
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
