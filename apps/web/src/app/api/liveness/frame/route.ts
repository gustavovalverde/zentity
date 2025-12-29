/**
 * Frame Processing Endpoint for Real-time Liveness Feedback
 *
 * Receives frames during liveness challenges and pushes detection
 * results to the client via SSE stream.
 */

import type { ChallengeType } from "@/lib/liveness";

import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "@/lib/liveness";
import {
  getFacingDirection,
  getHappyScore,
  getPrimaryFace,
  getYawDegrees,
} from "@/lib/liveness/human-metrics";
import { detectFromBase64 } from "@/lib/liveness/human-server";
import { createRequestLogger, sanitizeLogMessage } from "@/lib/logging";

import { sendSSEEvent } from "../stream/sse";

const frameSchema = z.object({
  sessionId: z.string().min(1),
  challengeType: z.enum(["smile", "turn_left", "turn_right"]),
  frameData: z.string().min(1),
  // Context from client for accurate comparison
  baselineHappy: z.number().optional(),
  turnStartYaw: z.number().optional(),
});

type ProgressResult = {
  challengeType: ChallengeType;
  faceDetected: boolean;
  progress: number; // 0-100
  passed: boolean;
  hint?: string;
  // Raw values for debugging
  happy?: number;
  yaw?: number;
  direction?: string;
};

function calculateProgress(
  challengeType: ChallengeType,
  face: ReturnType<typeof getPrimaryFace>,
  result: Awaited<ReturnType<typeof detectFromBase64>>,
  baselineHappy?: number,
  turnStartYaw?: number,
): ProgressResult {
  if (!face) {
    return {
      challengeType,
      faceDetected: false,
      progress: 0,
      passed: false,
      hint: "Position your face in the frame",
    };
  }

  const happy = getHappyScore(face);
  const yaw = getYawDegrees(face);
  const dir = getFacingDirection(result, face);

  if (challengeType === "smile") {
    const happyPct = Math.round(happy * 100);
    const baseline = baselineHappy ?? 0;
    const delta = happy - baseline;

    const passed =
      (happy >= SMILE_SCORE_THRESHOLD && delta >= SMILE_DELTA_THRESHOLD) ||
      happy >= SMILE_HIGH_THRESHOLD;

    let hint: string | undefined;
    if (!passed) {
      if (happyPct < 30) {
        hint = "Give a bigger smile!";
      } else if (happyPct < 50) {
        hint = "Almost there, smile more!";
      } else {
        hint = "Hold that smile...";
      }
    }

    return {
      challengeType,
      faceDetected: true,
      progress: happyPct,
      passed,
      hint,
      happy,
    };
  }

  // Turn challenges
  const referenceYaw = turnStartYaw ?? 0;
  const yawDelta = Math.abs(yaw - referenceYaw);
  const wantsLeft = challengeType === "turn_left";

  // Progress based on how close to threshold
  const progress = Math.min(
    (Math.abs(yaw) / TURN_YAW_ABSOLUTE_THRESHOLD_DEG) * 100,
    100,
  );

  const yawPassesAbsolute = wantsLeft
    ? yaw < -TURN_YAW_ABSOLUTE_THRESHOLD_DEG
    : yaw > TURN_YAW_ABSOLUTE_THRESHOLD_DEG;
  const yawPassesDelta = yawDelta >= TURN_YAW_SIGNIFICANT_DELTA_DEG;
  const correctDirection = wantsLeft ? yaw < referenceYaw : yaw > referenceYaw;

  const passed = correctDirection && (yawPassesAbsolute || yawPassesDelta);

  let hint: string | undefined;
  if (!passed) {
    if (dir === "center") {
      hint = wantsLeft
        ? "Turn your head to the left"
        : "Turn your head to the right";
    } else if (
      (wantsLeft && yaw > referenceYaw) ||
      (!wantsLeft && yaw < referenceYaw)
    ) {
      hint = `Turn the other way (${wantsLeft ? "left" : "right"})`;
    } else if (progress < 50) {
      hint = "Keep turning...";
    } else {
      hint = "Almost there, turn a bit more!";
    }
  } else {
    hint = "Hold the turn...";
  }

  return {
    challengeType,
    faceDetected: true,
    progress: Math.round(progress),
    passed,
    hint,
    yaw,
    direction: dir,
  };
}

export async function POST(req: NextRequest) {
  let sessionId: string | undefined;
  let challengeType: ChallengeType | undefined;
  const requestId =
    req.headers.get("x-request-id") ||
    req.headers.get("x-correlation-id") ||
    randomUUID();
  const log = createRequestLogger(requestId);
  try {
    const body = await req.json();
    const parsed = frameSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const {
      sessionId: parsedSessionId,
      challengeType: parsedChallengeType,
      frameData,
      baselineHappy,
      turnStartYaw,
    } = parsed.data;
    sessionId = parsedSessionId;
    challengeType = parsedChallengeType as ChallengeType;

    // Detect face in frame
    const result = await detectFromBase64(frameData);
    const face = getPrimaryFace(result);

    // Calculate progress
    const progress = calculateProgress(
      challengeType as ChallengeType,
      face,
      result,
      baselineHappy,
      turnStartYaw,
    );

    // Push to SSE stream
    await sendSSEEvent(sessionId, "progress", progress);

    return NextResponse.json({ received: true, ...progress });
  } catch (error) {
    // Avoid logging frame data (PII); only log minimal context.
    log.error(
      {
        path: "/api/liveness/frame",
        sessionId: sessionId ? `${sessionId.slice(0, 8)}...` : undefined,
        challengeType,
        error: sanitizeLogMessage(
          error instanceof Error ? error.message : String(error),
        ),
      },
      "Liveness frame processing failed",
    );
    return NextResponse.json(
      { error: "Frame processing failed" },
      { status: 500 },
    );
  }
}
