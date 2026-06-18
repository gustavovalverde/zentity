/**
 * Server-authoritative liveness engine.
 *
 * One module owning the whole flow: the keyed session store, the frame-driven
 * phase machine, the challenge evaluators, the anti-spoof gate, and the single
 * tamper-evident draft write. The client streams frames and never computes a
 * score that matters; the server holds the hidden challenge sequence, runs every
 * detection, and writes the result keyed to the authenticated user.
 *
 * Transport-agnostic by design: `advanceFrame` takes a JPEG buffer and a session
 * id, mutates the keyed session, and returns one snapshot/result/failure. The
 * route handler is a thin adapter over it; a future transport would call the
 * same function against the same store.
 *
 * Single-process store: the app runs as one long-lived Railway replica (pinned
 * by tfjs-node and the validity scheduler), so an in-process Map keyed by
 * sessionId is correct. A startup assertion enforces numReplicas=1.
 */
import "server-only";

import type {
  AdvanceResult,
  ChallengeState,
  ChallengeType,
  FaceState,
  LivenessFailure,
  LivenessPhase,
  LivenessSnapshot,
} from "./challenges";

import { createHash, randomInt, randomUUID } from "node:crypto";

import {
  getIdentityDraftById,
  updateIdentityDraft,
} from "@/lib/db/queries/identity";
import { logger } from "@/lib/logging/logger";

import { LivenessErrorState } from "./errors";
import {
  getFacingDirection,
  getHappyScore,
  getLiveScore,
  getPrimaryFace,
  getRealScore,
  getYawDegrees,
} from "./human/metrics";
import { detectFromBuffer } from "./human/server";
import {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "./thresholds";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Consecutive frames needed for a stable detection / challenge pass (~200ms at 10 FPS). */
const STABILITY_FRAMES = 2;
/** Yaw window (deg) within which the head counts as centered before a turn. */
const HEAD_CENTER_THRESHOLD = 5;
/** Per-session frame throttle (~12 FPS ceiling). */
const MIN_FRAME_INTERVAL_MS = 80;
/** Notify the client only after this many consecutive detection failures. */
const CONSECUTIVE_ERROR_THRESHOLD = 5;
const MIN_CHALLENGES = 1;
const MAX_CHALLENGES = 3;
const DEFAULT_CHALLENGE_COUNT = 2;
const SESSION_TTL_MS = 10 * 60 * 1000;

/** Hard body cap for a single frame (mirrors the old Socket.io maxHttpBufferSize). */
export const MAX_FRAME_BYTES = 1_000_000;

interface SessionTimeouts {
  challengeTimeoutMs: number;
  countdownDurationMs: number;
  sessionTimeoutMs: number;
}

const DEFAULT_TIMEOUTS: SessionTimeouts = {
  sessionTimeoutMs: 60_000,
  challengeTimeoutMs: 15_000,
  // Matches the client's visible 3-2-1 countdown so the server advance and the
  // on-screen counter stay in sync without a client "countdown done" signal.
  countdownDurationMs: 3000,
};

type DetectionResult = Awaited<ReturnType<typeof detectFromBuffer>>;
type DetectedFace = NonNullable<ReturnType<typeof getPrimaryFace>>;

interface LivenessSession {
  /** Data URL of the baseline frame the server scored; hashed into verifiedSelfieHash. */
  baselineFrame: string | null;

  baselineHappy: number | null;
  challenge: ChallengeState | null;
  challengeStartedAt: number | null;
  /** Hidden challenge sequence: generated server-side, never sent to the client. */
  challenges: ChallengeType[];
  consecutiveChallengePasses: number;
  consecutiveErrors: number;

  consecutiveFaceDetections: number;
  countdown: number | null;
  countdownStartedAt: number | null;
  currentIndex: number;
  draftId: string | null;
  face: FaceState;
  isProcessing: boolean;
  lastFrameAt: number;

  // Per-session guards persisted in the store because each frame is a separate request.
  lastFrameProcessedAt: number;
  lastHappyScore: number | null;

  phase: LivenessPhase;
  sessionId: string;

  startedAt: number;
  timeouts: SessionTimeouts;
  turnCentered: boolean;
  turnStartYaw: number | null;
  /** Bound from the authenticated session at creation; re-checked every frame. */
  userId: string;
}

// ---------------------------------------------------------------------------
// Keyed store (single-process; survives dev hot reload via globalThis)
// ---------------------------------------------------------------------------

const globalForLiveness = globalThis as unknown as {
  livenessSessions?: Map<string, LivenessSession>;
};
const sessions =
  globalForLiveness.livenessSessions ?? new Map<string, LivenessSession>();
globalForLiveness.livenessSessions = sessions;

function cleanupExpiredSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.startedAt < cutoff) {
      sessions.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Selfie hash (the one canonical representation; shared with faceMatch)
// ---------------------------------------------------------------------------

/**
 * The single source of truth for the selfie hash. The engine hashes the baseline
 * frame's JPEG data URL into the draft's verifiedSelfieHash; faceMatch hashes the
 * submitted selfie data URL with this same function. One function, no drift.
 */
export function hashSelfie(selfieDataUrl: string): string {
  return createHash("sha256").update(selfieDataUrl).digest("hex");
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function generateChallenges(count: number): ChallengeType[] {
  const pool: ChallengeType[] = ["smile", "turn_left", "turn_right"];

  // Fisher-Yates with crypto.randomInt for an unpredictable sequence.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = shuffled[i];
    const b = shuffled[j];
    if (a !== undefined && b !== undefined) {
      shuffled[i] = b;
      shuffled[j] = a;
    }
  }

  const challenges = shuffled.slice(0, count);

  // Ensure at least one head turn for better security.
  if (!challenges.some((c) => c.startsWith("turn"))) {
    const replaceIndex = randomInt(challenges.length);
    challenges[replaceIndex] = randomInt(2) === 0 ? "turn_left" : "turn_right";
  }

  return challenges;
}

interface CreatedLivenessSession {
  expiresAt: number;
  sessionId: string;
  snapshot: LivenessSnapshot;
}

/**
 * Create a session bound to the authenticated user. The draftId, if any, must be
 * validated as owned by the user by the caller before this is invoked. The full
 * challenge sequence is held server-side and never returned.
 */
export function createLivenessSession(args: {
  userId: string;
  draftId: string | null;
  challengeCount?: number;
}): CreatedLivenessSession {
  cleanupExpiredSessions();

  const count = Math.max(
    MIN_CHALLENGES,
    Math.min(MAX_CHALLENGES, args.challengeCount ?? DEFAULT_CHALLENGE_COUNT)
  );
  const now = Date.now();
  const session: LivenessSession = {
    sessionId: randomUUID(),
    userId: args.userId,
    draftId: args.draftId,
    phase: "detecting",
    challenges: generateChallenges(count),
    currentIndex: 0,
    challenge: null,
    face: { detected: false, box: null },
    countdown: null,
    consecutiveFaceDetections: 0,
    consecutiveChallengePasses: 0,
    baselineHappy: null,
    lastHappyScore: null,
    turnStartYaw: null,
    turnCentered: false,
    baselineFrame: null,
    startedAt: now,
    countdownStartedAt: null,
    challengeStartedAt: null,
    lastFrameAt: now,
    timeouts: { ...DEFAULT_TIMEOUTS },
    lastFrameProcessedAt: 0,
    isProcessing: false,
    consecutiveErrors: 0,
  };
  sessions.set(session.sessionId, session);

  return {
    sessionId: session.sessionId,
    expiresAt: now + SESSION_TTL_MS,
    snapshot: toSnapshot(session),
  };
}

// ---------------------------------------------------------------------------
// Frame advance (the single entry point)
// ---------------------------------------------------------------------------

/**
 * Process one frame. Returns the new state, a terminal result/failure, or null
 * when the session is missing or not owned by `userId` (the route maps null to
 * 404, without distinguishing the two so session ids cannot be enumerated).
 */
export async function advanceFrame(args: {
  sessionId: string;
  userId: string;
  frame: Buffer;
}): Promise<AdvanceResult | null> {
  const session = sessions.get(args.sessionId);
  if (!session || session.userId !== args.userId) {
    return null;
  }

  const now = Date.now();

  if (now - session.startedAt > session.timeouts.sessionTimeoutMs) {
    sessions.delete(session.sessionId);
    return fail(LivenessErrorState.SESSION_TIMEOUT, "Session timed out");
  }

  // Throttle and single-flight: drop the frame by returning the current snapshot.
  if (now - session.lastFrameProcessedAt < MIN_FRAME_INTERVAL_MS) {
    return toSnapshot(session);
  }
  if (session.isProcessing) {
    return toSnapshot(session);
  }

  session.isProcessing = true;
  session.lastFrameProcessedAt = now;
  session.lastFrameAt = now;

  try {
    const result = await detectFromBuffer(args.frame);
    const face = getPrimaryFace(result);

    session.face = face
      ? { detected: true, box: normalizeBox(face.box) }
      : { detected: false, box: null };
    session.lastHappyScore = face ? getHappyScore(face) : null;

    const dataUrl = `data:image/jpeg;base64,${args.frame.toString("base64")}`;
    const outcome = await processPhase(session, result, face, dataUrl);

    session.consecutiveErrors = 0;
    if (outcome.phase === "completed" || outcome.phase === "failed") {
      sessions.delete(session.sessionId);
    }
    return outcome;
  } catch (err) {
    session.consecutiveErrors++;
    logger.error(
      { err, sessionId: session.sessionId, count: session.consecutiveErrors },
      "Liveness frame processing error"
    );
    if (session.consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD) {
      session.consecutiveErrors = 0;
      return withHint(
        session,
        "Having trouble processing frames. Try adjusting lighting."
      );
    }
    return toSnapshot(session);
  } finally {
    session.isProcessing = false;
  }
}

function processPhase(
  session: LivenessSession,
  result: DetectionResult,
  face: ReturnType<typeof getPrimaryFace>,
  dataUrl: string
): Promise<AdvanceResult> | AdvanceResult {
  switch (session.phase) {
    case "detecting":
      return processDetecting(session, face);
    case "countdown":
      return processCountdown(session, face, dataUrl);
    case "challenging":
      return processChallenging(session, result, face);
    case "verifying":
      return processVerifying(session, face);
    default:
      return toSnapshot(session);
  }
}

function processDetecting(
  session: LivenessSession,
  face: ReturnType<typeof getPrimaryFace>
): AdvanceResult {
  if (!face) {
    session.consecutiveFaceDetections = 0;
    return withHint(session, "Position your face in the frame");
  }

  session.consecutiveFaceDetections++;
  if (session.consecutiveFaceDetections < STABILITY_FRAMES) {
    return withHint(session, "Hold still...");
  }

  session.phase = "countdown";
  session.countdownStartedAt = Date.now();
  session.countdown = Math.ceil(session.timeouts.countdownDurationMs / 1000);
  return toSnapshot(session);
}

/**
 * Frame-driven countdown: advances after countdownDurationMs of continuous
 * frames. No client "countdown done" signal is needed; the client's visible
 * 3-2-1 keys off the same duration so the two stay in sync.
 */
function processCountdown(
  session: LivenessSession,
  face: ReturnType<typeof getPrimaryFace>,
  dataUrl: string
): AdvanceResult {
  if (!face) {
    session.phase = "detecting";
    session.consecutiveFaceDetections = 0;
    session.countdownStartedAt = null;
    session.countdown = null;
    return withHint(session, "Face lost - please position your face again");
  }

  const elapsed = Date.now() - (session.countdownStartedAt ?? Date.now());
  const remaining = Math.max(0, session.timeouts.countdownDurationMs - elapsed);
  session.countdown = Math.ceil(remaining / 1000);

  if (elapsed < session.timeouts.countdownDurationMs) {
    return toSnapshot(session);
  }
  return startFirstChallenge(session, dataUrl);
}

function startFirstChallenge(
  session: LivenessSession,
  baselineDataUrl: string
): AdvanceResult {
  session.baselineFrame = baselineDataUrl;
  session.baselineHappy = session.lastHappyScore;
  session.countdown = null;
  session.countdownStartedAt = null;

  const first = session.challenges[0];
  if (first === undefined) {
    throw new Error("Session has no challenges configured");
  }
  session.phase = "challenging";
  session.currentIndex = 0;
  session.challenge = {
    type: first,
    index: 0,
    total: session.challenges.length,
    progress: 0,
    hint: getHintForChallenge(first),
  };
  session.challengeStartedAt = Date.now();
  session.consecutiveChallengePasses = 0;
  session.turnCentered = false;
  session.turnStartYaw = null;
  return toSnapshot(session);
}

function processChallenging(
  session: LivenessSession,
  result: DetectionResult,
  face: ReturnType<typeof getPrimaryFace>
): AdvanceResult {
  if (
    session.challengeStartedAt &&
    Date.now() - session.challengeStartedAt >
      session.timeouts.challengeTimeoutMs
  ) {
    return fail(LivenessErrorState.CHALLENGE_TIMEOUT, "Challenge timed out");
  }

  if (!face) {
    session.consecutiveChallengePasses = 0;
    session.phase = "detecting";
    session.challenge = null;
    session.challengeStartedAt = null;
    return withHint(session, "Face lost - position your face in the frame");
  }

  const challengeType = session.challenges[session.currentIndex];
  if (challengeType === undefined) {
    return toSnapshot(session);
  }

  const { passed, progress, hint } = evaluateChallenge(
    challengeType,
    face,
    result,
    session
  );
  if (session.challenge) {
    session.challenge.progress = progress;
    session.challenge.hint = hint;
  }

  if (!passed) {
    session.consecutiveChallengePasses = 0;
    return toSnapshot(session);
  }

  session.consecutiveChallengePasses++;
  if (session.consecutiveChallengePasses < STABILITY_FRAMES) {
    return withHint(session, "Hold it...");
  }

  // Challenge passed: capture nothing extra (only the baseline is consumed
  // downstream) and advance to the next challenge or verification.
  const allDone = advanceChallenge(session);
  if (allDone) {
    return withHint(session, "Verifying...");
  }

  const nextType = session.challenges[session.currentIndex];
  if (nextType === undefined) {
    return toSnapshot(session);
  }
  session.challenge = {
    type: nextType,
    index: session.currentIndex,
    total: session.challenges.length,
    progress: 0,
    hint: getHintForChallenge(nextType),
  };
  session.challengeStartedAt = Date.now();
  session.consecutiveChallengePasses = 0;
  session.turnCentered = false;
  session.turnStartYaw = null;
  return toSnapshot(session);
}

function advanceChallenge(session: LivenessSession): boolean {
  session.currentIndex++;
  session.consecutiveChallengePasses = 0;
  session.turnCentered = false;
  session.turnStartYaw = null;

  if (session.currentIndex >= session.challenges.length) {
    session.phase = "verifying";
    return true;
  }
  session.phase = "challenging";
  return false;
}

async function processVerifying(
  session: LivenessSession,
  face: ReturnType<typeof getPrimaryFace>
): Promise<AdvanceResult> {
  if (!face) {
    return withHint(session, "Keep your face visible for final verification");
  }

  const realScore = getRealScore(face);
  const liveScore = getLiveScore(face);
  const antispoofPassed = realScore >= ANTISPOOF_REAL_THRESHOLD;
  const livenessPassed = liveScore >= ANTISPOOF_LIVE_THRESHOLD;

  if (!(antispoofPassed && livenessPassed)) {
    logger.warn(
      { sessionId: session.sessionId, realScore, liveScore },
      "Anti-spoof check failed"
    );
    return fail(
      antispoofPassed
        ? LivenessErrorState.LIVENESS_FAILED
        : LivenessErrorState.ANTISPOOF_FAILED,
      "Verification failed - please try again with a live camera"
    );
  }

  const draftUpdated = await writeLivenessResult(session, realScore, liveScore);

  return {
    phase: "completed",
    verified: true,
    selfieImage: session.baselineFrame ?? "",
    confidence: Math.min(realScore, liveScore),
    draftUpdated,
  };
}

/**
 * The trust boundary write. Re-validates draft ownership against the session's
 * authenticated user at write time (not just at session creation), then writes
 * the server-computed scores and the canonical selfie hash. Returns whether the
 * draft was updated; a missing/unowned draft is logged and skipped, never forged.
 */
async function writeLivenessResult(
  session: LivenessSession,
  realScore: number,
  liveScore: number
): Promise<boolean> {
  if (!(session.draftId && session.baselineFrame)) {
    return false;
  }
  try {
    const draft = await getIdentityDraftById(session.draftId);
    if (!draft || draft.userId !== session.userId) {
      logger.warn(
        { sessionId: session.sessionId, draftId: session.draftId },
        "Draft ownership mismatch at liveness write; skipping"
      );
      return false;
    }
    await updateIdentityDraft(session.draftId, {
      userId: session.userId,
      antispoofScore: realScore,
      liveScore,
      verifiedSelfieHash: hashSelfie(session.baselineFrame),
    });
    logger.info(
      { sessionId: session.sessionId, draftId: session.draftId },
      "Liveness results written to draft"
    );
    return true;
  } catch (err) {
    logger.error(
      { err, sessionId: session.sessionId, draftId: session.draftId },
      "Failed to write liveness results to draft"
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Challenge evaluation (ported verbatim; the security-critical scoring)
// ---------------------------------------------------------------------------

function evaluateChallenge(
  type: ChallengeType,
  face: DetectedFace,
  result: DetectionResult,
  session: LivenessSession
): { passed: boolean; progress: number; hint: string } {
  if (type === "smile") {
    return evaluateSmile(face, session);
  }
  return evaluateTurn(type, face, result, session);
}

function evaluateSmile(
  face: DetectedFace,
  session: LivenessSession
): { passed: boolean; progress: number; hint: string } {
  const happy = getHappyScore(face);
  const baseline = session.baselineHappy ?? 0;
  const delta = happy - baseline;
  const progress = Math.min(Math.round(happy * 100), 100);

  const passed =
    (happy >= SMILE_SCORE_THRESHOLD && delta >= SMILE_DELTA_THRESHOLD) ||
    happy >= SMILE_HIGH_THRESHOLD;

  let hint = "Smile!";
  if (progress >= 70) {
    hint = "Hold that smile!";
  } else if (progress >= 40) {
    hint = "Bigger smile!";
  }

  return { passed, progress, hint };
}

function evaluateTurn(
  type: ChallengeType,
  face: DetectedFace,
  result: DetectionResult,
  session: LivenessSession
): { passed: boolean; progress: number; hint: string } {
  const yaw = getYawDegrees(face);
  const dir = getFacingDirection(result, face, HEAD_CENTER_THRESHOLD);
  const wantsLeft = type === "turn_left";

  // The user must center their head before the turn counts.
  if (!session.turnCentered) {
    if (dir === "center") {
      session.turnCentered = true;
      session.turnStartYaw = yaw;
    } else {
      return { passed: false, progress: 0, hint: "Center your head first" };
    }
  }

  const startYaw = session.turnStartYaw ?? 0;
  const yawDelta = Math.abs(yaw - startYaw);
  const progress = Math.min(
    Math.round((Math.abs(yaw) / TURN_YAW_ABSOLUTE_THRESHOLD_DEG) * 100),
    100
  );

  const absolutePass = wantsLeft
    ? yaw < -TURN_YAW_ABSOLUTE_THRESHOLD_DEG
    : yaw > TURN_YAW_ABSOLUTE_THRESHOLD_DEG;
  const deltaPass = yawDelta >= TURN_YAW_SIGNIFICANT_DELTA_DEG;
  const correctDirection = wantsLeft ? yaw < startYaw : yaw > startYaw;
  const passed = correctDirection && (absolutePass || deltaPass);

  let hint = wantsLeft ? "Turn your head left" : "Turn your head right";
  if (passed) {
    hint = "Hold it!";
  } else if (progress >= 50) {
    hint = "Keep turning...";
  } else if (!correctDirection && yawDelta > 5) {
    hint = `Wrong direction - turn ${wantsLeft ? "left" : "right"}`;
  }

  return { passed, progress, hint };
}

function getHintForChallenge(type: ChallengeType): string {
  switch (type) {
    case "smile":
      return "Smile!";
    case "turn_left":
      return "Turn your head to the left";
    case "turn_right":
      return "Turn your head to the right";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Snapshot / outcome builders
// ---------------------------------------------------------------------------

function toSnapshot(session: LivenessSession): LivenessSnapshot {
  return {
    phase: session.phase,
    challenge: session.challenge,
    face: session.face,
    countdown: session.countdown,
  };
}

function withHint(session: LivenessSession, hint: string): LivenessSnapshot {
  return { ...toSnapshot(session), hint };
}

function fail(code: LivenessFailure["code"], message: string): LivenessFailure {
  return { phase: "failed", code, message, canRetry: true };
}

function normalizeBox(
  box: DetectedFace["box"]
): { x: number; y: number; width: number; height: number } | null {
  if (!box) {
    return null;
  }
  if (Array.isArray(box)) {
    return { x: box[0], y: box[1], width: box[2], height: box[3] };
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}
