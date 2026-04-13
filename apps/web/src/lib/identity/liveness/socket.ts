/**
 * Socket.io server-side liveness pipeline.
 *
 * Runs outside of Next.js RSC context (via server.mjs); each connection is
 * a liveness session. The client streams video frames; the server runs face
 * detection, evaluates challenges, and (when linked to an identity draft)
 * writes liveness results directly to the database so clients cannot forge
 * them.
 *
 * Contains three concerns kept in one deep module because they're cohesive
 * and share exactly one external entry point:
 *   1. Pino logger configured for the socket context
 *   2. Session state machine (pure functions + types)
 *   3. Socket.io connection handler (event wiring + phase orchestration)
 */

import type { Socket } from "socket.io";
import type { ChallengeType } from "./challenges";

import { createHash, randomInt } from "node:crypto";

import pino from "pino";

import { env } from "@/env";
import {
  getIdentityDraftById,
  updateIdentityDraft,
} from "@/lib/db/queries/identity";

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
// Logger
// ---------------------------------------------------------------------------
// Standalone pino: no `server-only` import because this module runs outside
// Next.js RSC context. Same configuration as the main logger.

type Logger = import("pino").Logger;

const isDev = env.NODE_ENV !== "production";
const logLevel = env.LOG_LEVEL || (isDev ? "debug" : "info");

const logger: Logger = pino({
  level: logLevel,
  base: {
    service: "zentity-web",
    component: "liveness-socket",
    env: env.NODE_ENV,
  },
});

// ---------------------------------------------------------------------------
// Session state machine
// ---------------------------------------------------------------------------

type SessionPhase =
  | "connecting"
  | "detecting" // Looking for face
  | "countdown" // 3-2-1 before baseline
  | "baseline" // Capturing neutral face
  | "challenging" // Active challenge
  | "capturing" // Storing challenge frame
  | "verifying" // Final checks
  | "completed" // Success
  | "failed"; // Failure

interface ChallengeState {
  hint: string | null;
  index: number;
  progress: number; // 0-100
  total: number;
  type: ChallengeType;
}

interface FaceState {
  box: { x: number; y: number; width: number; height: number } | null;
  detected: boolean;
}

interface SessionState {
  // Captured frames (base64)
  baselineFrame: string | null;
  baselineHappy: number | null;
  challenge: ChallengeState | null;
  challengeAwaitingClient: boolean;
  challengeFrames: Map<ChallengeType, string>;
  challengeRequestedAt: number | null;
  challengeStartedAt: number | null;

  // Internal tracking
  challenges: ChallengeType[];
  consecutiveChallengeDetections: number;
  consecutiveFaceDetections: number;
  countdown: number | null;
  countdownAwaitingClient: boolean;
  countdownRequestedAt: number | null;
  currentIndex: number;

  // Identity draft linkage (for dashboard verification flow)
  draftId: string | null;
  face: FaceState;
  id: string;
  lastFrameAt: number;
  lastFrameDataUrl: string | null;
  lastHappyScore: number | null;
  pendingBaselineFrame: string | null;
  phase: SessionPhase;

  // Retry tracking
  retryCount: number;

  // Timing
  startedAt: number;

  // Configurable timeouts
  timeouts: SessionTimeouts;
  turnCentered: boolean;
  turnStartYaw: number | null;
  userId: string | null;
}

// Consecutive frames needed for stable detection.
// Reduced from 3 to 2 for faster response (~200ms at 10 FPS).
const STABILITY_FRAMES = 2;

interface SessionTimeouts {
  /** Maximum time per challenge in milliseconds */
  challengeTimeoutMs: number;
  /** Countdown duration in milliseconds */
  countdownDurationMs: number;
  /** Maximum session duration in milliseconds */
  sessionTimeoutMs: number;
}

const DEFAULT_TIMEOUTS: SessionTimeouts = {
  sessionTimeoutMs: 60_000, // 60 seconds max
  challengeTimeoutMs: 15_000, // 15 seconds per challenge
  countdownDurationMs: 2000, // 2 second countdown (reduced from 3)
};

// Challenge count bounds — cap to available unique challenges to avoid repeats
// and prevent DoS via excessive challenges.
const MIN_CHALLENGES = 1;
const MAX_CHALLENGES = 3;

function createSession(
  numChallenges = 2,
  timeouts: Partial<SessionTimeouts> = {},
  options?: { draftId?: string | undefined; userId?: string | undefined }
): SessionState {
  // Silently clamp to valid range (security: prevent DoS)
  const count = Math.max(
    MIN_CHALLENGES,
    Math.min(MAX_CHALLENGES, numChallenges)
  );
  const challenges = generateChallenges(count);
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    phase: "detecting",
    challenge: null,
    face: { detected: false, box: null },
    countdown: null,

    draftId: options?.draftId ?? null,
    userId: options?.userId ?? null,

    challenges,
    currentIndex: 0,
    consecutiveFaceDetections: 0,
    consecutiveChallengeDetections: 0,
    baselineHappy: null,
    lastHappyScore: null,
    turnStartYaw: null,
    turnCentered: false,
    countdownAwaitingClient: false,
    countdownRequestedAt: null,
    pendingBaselineFrame: null,
    lastFrameDataUrl: null,
    challengeAwaitingClient: false,
    challengeRequestedAt: null,
    challengeStartedAt: null,

    baselineFrame: null,
    challengeFrames: new Map(),

    startedAt: now,
    lastFrameAt: now,

    retryCount: 0,
    timeouts: { ...DEFAULT_TIMEOUTS, ...timeouts },
  };
}

function generateChallenges(count: number): ChallengeType[] {
  const pool: ChallengeType[] = ["smile", "turn_left", "turn_right"];

  // Fisher-Yates shuffle with crypto.randomInt for unpredictability
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

  // Ensure at least one turn for better security
  if (!challenges.some((c) => c.startsWith("turn"))) {
    const replaceIndex = randomInt(challenges.length);
    challenges[replaceIndex] = randomInt(2) === 0 ? "turn_left" : "turn_right";
  }

  return challenges;
}

function isSessionExpired(session: SessionState): boolean {
  const elapsed = Date.now() - session.startedAt;
  return elapsed > session.timeouts.sessionTimeoutMs;
}

function isChallengeExpired(session: SessionState): boolean {
  if (session.phase !== "challenging") {
    return false;
  }
  if (!session.challengeStartedAt) {
    return false;
  }
  const elapsed = Date.now() - session.challengeStartedAt;
  return elapsed > session.timeouts.challengeTimeoutMs;
}

function recordFaceDetection(session: SessionState): number {
  session.consecutiveFaceDetections++;
  return session.consecutiveFaceDetections;
}

function resetFaceDetection(session: SessionState): void {
  session.consecutiveFaceDetections = 0;
}

function recordChallengePass(session: SessionState): number {
  session.consecutiveChallengeDetections++;
  return session.consecutiveChallengeDetections;
}

function resetChallengePass(session: SessionState): void {
  session.consecutiveChallengeDetections = 0;
}

function hasStableDetection(session: SessionState): boolean {
  return session.consecutiveFaceDetections >= STABILITY_FRAMES;
}

function hasStableChallengePass(session: SessionState): boolean {
  return session.consecutiveChallengeDetections >= STABILITY_FRAMES;
}

function advanceChallenge(session: SessionState): boolean {
  session.currentIndex++;
  session.consecutiveChallengeDetections = 0;
  session.turnCentered = false;
  session.turnStartYaw = null;

  if (session.currentIndex >= session.challenges.length) {
    session.phase = "verifying";
    return true; // All challenges done
  }

  session.phase = "challenging";
  return false; // More challenges remain
}

function toClientState(session: SessionState): {
  id: string;
  phase: SessionPhase;
  challenge: ChallengeState | null;
  face: FaceState;
  countdown: number | null;
} {
  return {
    id: session.id,
    phase: session.phase,
    // session.challenge has the actual progress and hint values
    // that are updated during challenge evaluation
    challenge: session.challenge,
    face: session.face,
    countdown: session.countdown,
  };
}

// ---------------------------------------------------------------------------
// Socket handler
// ---------------------------------------------------------------------------

// Thresholds
const HEAD_CENTER_THRESHOLD = 5; // degrees

// Rate limiting
const MIN_FRAME_INTERVAL_MS = 80; // Max ~12 FPS

// Error handling - only notify client of persistent issues
const CONSECUTIVE_ERROR_THRESHOLD = 5;

// Completion acknowledgment timeout
const COMPLETION_ACK_TIMEOUT_MS = 5000;
// Countdown auto-advance fallback if client never finishes countdown
const COUNTDOWN_AUTO_ADVANCE_MS = 5000;
// Challenge auto-start fallback if client never acknowledges prompt
// Client signals immediately now, so this is just a safety net for edge cases
const CHALLENGE_READY_TIMEOUT_MS = 100;

export function handleLivenessConnection(socket: Socket): void {
  const log = logger.child({ socketId: socket.id });
  log.info("Liveness connection opened");

  let session: SessionState | null = null;
  let lastFrameTime = 0;
  let isProcessing = false;
  let consecutiveErrors = 0;

  // Start session
  socket.on(
    "start",
    async (config?: {
      challenges?: number;
      timeouts?: Partial<SessionTimeouts>;
      draftId?: string;
      userId?: string;
    }) => {
      const numChallenges = config?.challenges ?? 2;
      const timeouts = config?.timeouts ?? {};

      // Validate draftId/userId linkage for dashboard flow
      let validatedDraftId: string | undefined;
      let validatedUserId: string | undefined;

      if (config?.draftId && config?.userId) {
        const draft = await getIdentityDraftById(config.draftId);
        if (draft && draft.userId === config.userId) {
          validatedDraftId = config.draftId;
          validatedUserId = config.userId;
          log.info(
            { draftId: validatedDraftId },
            "Linked liveness session to identity draft"
          );
        } else {
          log.warn(
            { draftId: config.draftId, userId: config.userId },
            "Draft validation failed - ignoring linkage"
          );
        }
      }

      session = createSession(numChallenges, timeouts, {
        draftId: validatedDraftId,
        userId: validatedUserId,
      });
      log.info(
        {
          sessionId: session.id,
          challenges: session.challenges,
          timeouts: session.timeouts,
          hasDraftLink: Boolean(validatedDraftId),
        },
        "Session started"
      );

      // Send initial state with timeout config for client awareness
      socket.emit("state", {
        ...toClientState(session),
        timeouts: session.timeouts,
      });
    }
  );

  // Handle binary frame
  socket.on("frame", async (data: Buffer | ArrayBuffer) => {
    if (!session) {
      socket.emit("error", {
        code: "no_session",
        message: "Start a session first",
      });
      return;
    }

    // Check session timeout
    if (isSessionExpired(session)) {
      session.phase = "failed";
      socket.emit("failed", {
        code: LivenessErrorState.SESSION_TIMEOUT,
        message: "Session timed out",
        canRetry: true,
      });
      return;
    }

    // Rate limiting
    const now = Date.now();
    if (now - lastFrameTime < MIN_FRAME_INTERVAL_MS) {
      return; // Drop frame
    }
    lastFrameTime = now;
    session.lastFrameAt = now;

    // Skip if already processing
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

      // Run detection directly from buffer (skips base64→Buffer round-trip)
      const result = await detectFromBuffer(buffer);

      // Convert to data URL only for storage (needed for frame retrieval later)
      const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      const face = getPrimaryFace(result);

      // Update face state
      if (face) {
        const box = face.box;
        let normalizedBox: {
          x: number;
          y: number;
          width: number;
          height: number;
        } | null = null;
        if (box) {
          if (Array.isArray(box)) {
            normalizedBox = {
              x: box[0],
              y: box[1],
              width: box[2],
              height: box[3],
            };
          } else {
            normalizedBox = {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            };
          }
        }
        session.face = {
          detected: true,
          box: normalizedBox,
        };
      } else {
        session.face = { detected: false, box: null };
      }
      session.lastFrameDataUrl = dataUrl;
      session.lastHappyScore = face ? getHappyScore(face) : null;

      // Process based on current phase (await to hold isProcessing lock)
      await processPhase(socket, session, result, face, dataUrl, log);

      // Reset error counter on success
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      log.error({ err, consecutiveErrors }, "Frame processing error");

      // Only notify client of persistent issues (not transient glitches)
      if (consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD) {
        socket.emit("error", {
          code: "detection_degraded",
          message: "Having trouble processing frames. Try adjusting lighting.",
          transient: true,
        });
        // Reset counter to avoid spamming
        consecutiveErrors = 0;
      }
    } finally {
      isProcessing = false;
    }
  });

  // Handle retry - soft retries within a session
  const MAX_RETRIES = 3;
  socket.on("retry", () => {
    if (!session) {
      session = createSession();
      log.info({ sessionId: session.id }, "New session created for retry");
      socket.emit("state", toClientState(session));
      return;
    }

    // Check retry limit
    if (session.retryCount >= MAX_RETRIES) {
      log.warn(
        { sessionId: session.id, retryCount: session.retryCount },
        "Max retries exceeded"
      );
      socket.emit("failed", {
        code: LivenessErrorState.SESSION_EXPIRED,
        message: "Maximum retries exceeded",
        canRetry: false,
      });
      return;
    }

    // Increment retry count and reset session state for new attempt
    session.retryCount++;
    session.phase = "detecting";
    session.currentIndex = 0;
    session.challenge = null;
    session.face = { detected: false, box: null };
    session.countdown = null;
    session.consecutiveFaceDetections = 0;
    session.consecutiveChallengeDetections = 0;
    session.baselineHappy = null;
    session.lastHappyScore = null;
    session.turnStartYaw = null;
    session.turnCentered = false;
    session.countdownAwaitingClient = false;
    session.countdownRequestedAt = null;
    session.pendingBaselineFrame = null;
    session.lastFrameDataUrl = null;
    session.challengeAwaitingClient = false;
    session.challengeRequestedAt = null;
    session.challengeStartedAt = null;
    session.baselineFrame = null;
    session.challengeFrames.clear();
    session.startedAt = Date.now();
    session.lastFrameAt = Date.now();

    log.info(
      { sessionId: session.id, retryCount: session.retryCount },
      "Session retry - resetting for new attempt"
    );
    socket.emit("state", toClientState(session));
  });

  // Client signals that local countdown finished.
  socket.on("countdown:done", () => {
    if (!session) {
      return;
    }
    if (session.phase !== "countdown" || !session.countdownAwaitingClient) {
      return;
    }
    const baselineFrame =
      session.lastFrameDataUrl ?? session.pendingBaselineFrame ?? "";
    advanceAfterCountdown(socket, session, baselineFrame);
  });

  // Client signals that challenge instruction has completed.
  socket.on("challenge:ready", () => {
    if (!session) {
      return;
    }
    if (session.phase !== "challenging" || !session.challengeAwaitingClient) {
      return;
    }
    session.challengeAwaitingClient = false;
    session.challengeRequestedAt = null;
    session.challengeStartedAt = Date.now();
    resetChallengePass(session);
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    log.info({ reason, sessionId: session?.id }, "Liveness connection closed");

    // Explicitly release frame storage before nullifying session.
    // Base64 images can be 100KB+ each; clearing helps GC reclaim memory faster.
    if (session) {
      session.challengeFrames.clear();
      session.baselineFrame = null;
      session.lastFrameDataUrl = null;
      session.pendingBaselineFrame = null;
    }

    // Clear all local state
    session = null;
    isProcessing = false;
    consecutiveErrors = 0;
    lastFrameTime = 0;
  });
}

async function processPhase(
  socket: Socket,
  session: SessionState,
  result: Awaited<ReturnType<typeof detectFromBuffer>>,
  face: ReturnType<typeof getPrimaryFace>,
  frameDataUrl: string,
  log: Logger
): Promise<void> {
  switch (session.phase) {
    case "detecting":
      handleDetectingPhase(socket, session, face, frameDataUrl);
      break;

    case "countdown":
      handleCountdownPhase(socket, session, face, frameDataUrl);
      break;

    case "baseline":
      handleBaselinePhase(socket, session, face, frameDataUrl);
      break;

    case "challenging":
      handleChallengePhase(socket, session, result, face, frameDataUrl);
      break;

    case "verifying":
      await handleVerifyingPhase(socket, session, result, face, log);
      break;

    case "completed":
    case "failed":
      // Terminal states - ignore frames
      break;

    default:
      // Send current state
      socket.emit("state", toClientState(session));
  }
}

function handleDetectingPhase(
  socket: Socket,
  session: SessionState,
  face: ReturnType<typeof getPrimaryFace>,
  frameDataUrl: string
): void {
  if (!face) {
    resetFaceDetection(session);
    socket.emit("state", {
      ...toClientState(session),
      hint: "Position your face in the frame",
    });
    return;
  }

  recordFaceDetection(session);

  if (hasStableDetection(session)) {
    // Face is stable, start countdown
    session.phase = "countdown";
    session.countdown = null;
    session.countdownAwaitingClient = true;
    session.countdownRequestedAt = Date.now();
    session.pendingBaselineFrame = frameDataUrl;
    socket.emit("state", toClientState(session));
  } else {
    socket.emit("state", {
      ...toClientState(session),
      hint: "Hold still...",
    });
  }
}

function handleCountdownPhase(
  socket: Socket,
  session: SessionState,
  face: ReturnType<typeof getPrimaryFace>,
  frameDataUrl: string
): void {
  if (!(session.countdownAwaitingClient && session.countdownRequestedAt)) {
    return;
  }

  if (!face) {
    session.phase = "detecting";
    resetFaceDetection(session);
    session.countdownAwaitingClient = false;
    session.countdownRequestedAt = null;
    session.pendingBaselineFrame = null;
    socket.emit("state", {
      ...toClientState(session),
      hint: "Face lost - please position your face again",
    });
    return;
  }

  const elapsed = Date.now() - session.countdownRequestedAt;
  if (elapsed < COUNTDOWN_AUTO_ADVANCE_MS) {
    return;
  }

  const baselineFrame =
    session.lastFrameDataUrl ?? session.pendingBaselineFrame ?? frameDataUrl;
  advanceAfterCountdown(socket, session, baselineFrame);
}

function advanceAfterCountdown(
  socket: Socket,
  session: SessionState,
  frameDataUrl: string
): void {
  session.countdownAwaitingClient = false;
  session.countdownRequestedAt = null;
  session.pendingBaselineFrame = null;
  session.countdown = null;

  session.baselineFrame = frameDataUrl;
  session.baselineHappy = session.lastHappyScore ?? null;

  const firstChallenge = session.challenges[0];
  if (firstChallenge === undefined) {
    throw new Error("Session has no challenges configured");
  }
  session.phase = "challenging";
  session.challenge = {
    type: firstChallenge,
    index: 0,
    total: session.challenges.length,
    progress: 0,
    hint: getHintForChallenge(firstChallenge),
  };
  session.challengeAwaitingClient = true;
  session.challengeRequestedAt = Date.now();
  session.challengeStartedAt = null;
  resetChallengePass(session);

  socket.emit("state", toClientState(session));
}

function handleBaselinePhase(
  socket: Socket,
  session: SessionState,
  face: ReturnType<typeof getPrimaryFace>,
  frameDataUrl: string
): void {
  if (!face) {
    // Lost face during baseline - back to detecting
    session.phase = "detecting";
    resetFaceDetection(session);
    socket.emit("state", {
      ...toClientState(session),
      hint: "Face lost - please position your face again",
    });
    return;
  }

  // Store baseline
  session.baselineFrame = frameDataUrl;
  session.baselineHappy = getHappyScore(face);

  // Start first challenge
  session.phase = "challenging";
  session.challengeAwaitingClient = true;
  session.challengeRequestedAt = Date.now();
  session.challengeStartedAt = null;
  resetChallengePass(session);
  socket.emit("state", toClientState(session));
}

function handleChallengePhase(
  socket: Socket,
  session: SessionState,
  result: Awaited<ReturnType<typeof detectFromBuffer>>,
  face: ReturnType<typeof getPrimaryFace>,
  frameDataUrl: string
): void {
  if (session.challengeAwaitingClient) {
    if (
      session.challengeRequestedAt &&
      Date.now() - session.challengeRequestedAt > CHALLENGE_READY_TIMEOUT_MS
    ) {
      session.challengeAwaitingClient = false;
      session.challengeRequestedAt = null;
      session.challengeStartedAt = Date.now();
      resetChallengePass(session);
    } else {
      return;
    }
  }

  // Check challenge timeout
  if (isChallengeExpired(session)) {
    session.phase = "failed";
    socket.emit("failed", {
      code: LivenessErrorState.CHALLENGE_TIMEOUT,
      message: "Challenge timed out",
      canRetry: true,
    });
    return;
  }

  if (!face) {
    resetChallengePass(session);
    session.phase = "detecting";
    session.challengeAwaitingClient = false;
    session.challengeRequestedAt = null;
    session.challengeStartedAt = null;
    socket.emit("state", {
      ...toClientState(session),
      hint: "Face lost - position your face in the frame",
    });
    return;
  }

  const challengeType = session.challenges[session.currentIndex];
  if (challengeType === undefined) {
    return;
  }
  const { passed, progress, hint } = evaluateChallenge(
    challengeType,
    face,
    result,
    session
  );

  // Update challenge state
  if (session.challenge) {
    session.challenge.progress = progress;
    session.challenge.hint = hint;
  }

  if (passed) {
    recordChallengePass(session);

    if (hasStableChallengePass(session)) {
      // Challenge passed! Store frame and advance
      session.challengeFrames.set(challengeType, frameDataUrl);

      const allDone = advanceChallenge(session);

      if (allDone) {
        session.phase = "verifying";
        session.challengeAwaitingClient = false;
        session.challengeRequestedAt = null;
        session.challengeStartedAt = null;
        socket.emit("state", {
          ...toClientState(session),
          hint: "Verifying...",
        });
      } else {
        // Next challenge
        const nextType = session.challenges[session.currentIndex];
        if (nextType === undefined) {
          return;
        }
        session.challenge = {
          type: nextType,
          index: session.currentIndex,
          total: session.challenges.length,
          progress: 0,
          hint: getHintForChallenge(nextType),
        };
        session.challengeAwaitingClient = true;
        session.challengeRequestedAt = Date.now();
        session.challengeStartedAt = null;
        resetChallengePass(session);
        socket.emit("state", toClientState(session));
      }
    } else {
      socket.emit("state", {
        ...toClientState(session),
        hint: "Hold it...",
      });
    }
  } else {
    resetChallengePass(session);
    socket.emit("state", toClientState(session));
  }
}

async function handleVerifyingPhase(
  socket: Socket,
  session: SessionState,
  _result: Awaited<ReturnType<typeof detectFromBuffer>>,
  face: ReturnType<typeof getPrimaryFace>,
  log: Logger
): Promise<void> {
  if (!face) {
    socket.emit("state", {
      ...toClientState(session),
      hint: "Keep your face visible for final verification",
    });
    return;
  }

  // Check anti-spoofing
  const realScore = getRealScore(face);
  const liveScore = getLiveScore(face);

  const antispoofPassed = realScore >= ANTISPOOF_REAL_THRESHOLD;
  const livenessPassed = liveScore >= ANTISPOOF_LIVE_THRESHOLD;

  if (!(antispoofPassed && livenessPassed)) {
    log.warn(
      {
        sessionId: session.id,
        realScore,
        liveScore,
        antispoofPassed,
        livenessPassed,
      },
      "Anti-spoof check failed"
    );
    session.phase = "failed";
    socket.emit("failed", {
      code: antispoofPassed
        ? LivenessErrorState.LIVENESS_FAILED
        : LivenessErrorState.ANTISPOOF_FAILED,
      message: "Verification failed - please try again with a live camera",
      canRetry: true,
    });
    return;
  }

  // Transition to completed BEFORE async work to prevent duplicate processing
  // (multiple frames can enter this handler concurrently via processPhase)
  session.phase = "completed";

  // Write liveness results directly to database if draft is linked
  // This is the secure path - server writes results, not client
  let draftUpdated = false;
  if (session.draftId && session.userId) {
    try {
      const verifiedSelfieHash = session.baselineFrame
        ? createHash("sha256").update(session.baselineFrame).digest("hex")
        : null;
      await updateIdentityDraft(session.draftId, {
        userId: session.userId,
        antispoofScore: realScore,
        liveScore,
        verifiedSelfieHash,
      });
      draftUpdated = true;
      log.info(
        {
          sessionId: session.id,
          draftId: session.draftId,
          realScore,
          liveScore,
        },
        "Liveness results written to draft"
      );
    } catch (err) {
      log.error(
        { sessionId: session.id, draftId: session.draftId, err },
        "Failed to write liveness results to draft"
      );
    }
  }
  const completionData = {
    verified: true,
    sessionId: session.id,
    selfieImage: session.baselineFrame || "",
    confidence: Math.min(realScore, liveScore),
    antispoofPassed,
    livenessPassed,
    draftUpdated,
  };

  socket
    .timeout(COMPLETION_ACK_TIMEOUT_MS)
    .emit("completed", completionData, (err: Error | null) => {
      if (err) {
        // Client didn't acknowledge (disconnect or timeout)
        log.warn(
          { sessionId: session.id, error: err.message },
          "Completion not acknowledged by client"
        );
      } else {
        log.info({ sessionId: session.id }, "Completion acknowledged");
      }
    });
}

function evaluateChallenge(
  type: string,
  face: NonNullable<ReturnType<typeof getPrimaryFace>>,
  result: Awaited<ReturnType<typeof detectFromBuffer>>,
  session: SessionState
): { passed: boolean; progress: number; hint: string } {
  if (type === "smile") {
    return evaluateSmile(face, session);
  }
  return evaluateTurn(type, face, result, session);
}

function evaluateSmile(
  face: NonNullable<ReturnType<typeof getPrimaryFace>>,
  session: SessionState
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
  type: string,
  face: NonNullable<ReturnType<typeof getPrimaryFace>>,
  result: Awaited<ReturnType<typeof detectFromBuffer>>,
  session: SessionState
): { passed: boolean; progress: number; hint: string } {
  const yaw = getYawDegrees(face);
  const dir = getFacingDirection(result, face, HEAD_CENTER_THRESHOLD);
  const wantsLeft = type === "turn_left";

  // First, user must center their head
  if (!session.turnCentered) {
    if (dir === "center") {
      session.turnCentered = true;
      session.turnStartYaw = yaw;
    } else {
      return {
        passed: false,
        progress: 0,
        hint: "Center your head first",
      };
    }
  }

  const startYaw = session.turnStartYaw ?? 0;
  const yawDelta = Math.abs(yaw - startYaw);

  // Progress based on absolute angle
  const progress = Math.min(
    Math.round((Math.abs(yaw) / TURN_YAW_ABSOLUTE_THRESHOLD_DEG) * 100),
    100
  );

  // Check pass conditions
  const absolutePass = wantsLeft
    ? yaw < -TURN_YAW_ABSOLUTE_THRESHOLD_DEG
    : yaw > TURN_YAW_ABSOLUTE_THRESHOLD_DEG;
  const deltaPass = yawDelta >= TURN_YAW_SIGNIFICANT_DELTA_DEG;
  const correctDirection = wantsLeft ? yaw < startYaw : yaw > startYaw;

  const passed = correctDirection && (absolutePass || deltaPass);

  // Generate hint
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

function getHintForChallenge(type: string): string {
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
