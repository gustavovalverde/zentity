/**
 * Socket.io handler for server-side liveness detection.
 *
 * Each connection is a liveness session. The client sends video frames,
 * and the server does all face detection and challenge evaluation.
 */

import type { Socket } from "socket.io";

import {
  getFacingDirection,
  getHappyScore,
  getLiveScore,
  getPrimaryFace,
  getRealScore,
  getYawDegrees,
} from "../human-metrics";
import { detectFromBase64 } from "../human-server";
import {
  ANTISPOOF_REAL_THRESHOLD,
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "../policy";
import { type Logger, socketLogger as logger } from "./logger";
import {
  advanceChallenge,
  createSession,
  hasStableChallengePass,
  hasStableDetection,
  isChallengeExpired,
  isSessionExpired,
  recordChallengePass,
  recordFaceDetection,
  resetChallengePass,
  resetFaceDetection,
  type SessionState,
  toClientState,
} from "./session";

// Thresholds
const HEAD_CENTER_THRESHOLD = 5; // degrees

// Rate limiting
const MIN_FRAME_INTERVAL_MS = 80; // Max ~12 FPS

// Error handling - only notify client of persistent issues
const CONSECUTIVE_ERROR_THRESHOLD = 5;

// Completion acknowledgment timeout
const COMPLETION_ACK_TIMEOUT_MS = 5000;

/**
 * Handle a new liveness socket connection.
 */
export function handleLivenessConnection(socket: Socket): void {
  const log = logger.child({ socketId: socket.id });
  log.info("Liveness connection opened");

  let session: SessionState | null = null;
  let lastFrameTime = 0;
  let isProcessing = false;
  let consecutiveErrors = 0;

  // Start session
  socket.on("start", (config?: { challenges?: number }) => {
    const numChallenges = config?.challenges ?? 2;
    session = createSession(numChallenges);
    log.info(
      { sessionId: session.id, challenges: session.challenges },
      "Session started"
    );

    // Send initial state
    socket.emit("state", toClientState(session));
  });

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
        code: "timeout",
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
      // Convert buffer to base64 data URL
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const base64 = buffer.toString("base64");
      const dataUrl = `data:image/jpeg;base64,${base64}`;

      // Run server-side detection
      const result = await detectFromBase64(dataUrl);
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

      // Process based on current phase
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

  // Handle retry
  socket.on("retry", () => {
    if (session) {
      log.info({ oldSessionId: session.id }, "Session retry requested");
    }
    session = createSession();
    log.info({ sessionId: session.id }, "New session created for retry");
    socket.emit("state", toClientState(session));
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    log.info({ reason, sessionId: session?.id }, "Liveness connection closed");
    session = null;
  });
}

/**
 * Process frame based on current session phase.
 */
async function processPhase(
  socket: Socket,
  session: SessionState,
  result: Awaited<ReturnType<typeof detectFromBase64>>,
  face: ReturnType<typeof getPrimaryFace>,
  frameDataUrl: string,
  log: Logger
): Promise<void> {
  switch (session.phase) {
    case "detecting":
      await handleDetectingPhase(socket, session, face, frameDataUrl);
      break;

    case "countdown":
      // Countdown is handled client-side, just wait for baseline
      break;

    case "baseline":
      await handleBaselinePhase(socket, session, face, frameDataUrl);
      break;

    case "challenging":
      handleChallengePhase(socket, session, result, face, frameDataUrl);
      break;

    case "verifying":
      handleVerifyingPhase(socket, session, result, face, log);
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

/**
 * Handle detecting phase - looking for stable face.
 */
async function handleDetectingPhase(
  socket: Socket,
  session: SessionState,
  face: ReturnType<typeof getPrimaryFace>,
  frameDataUrl: string
): Promise<void> {
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
    session.countdown = 3;

    socket.emit("state", toClientState(session));

    // Auto-advance countdown (server controls timing)
    await countdownAndCapture(socket, session, frameDataUrl);
  } else {
    socket.emit("state", {
      ...toClientState(session),
      hint: "Hold still...",
    });
  }
}

/**
 * Run countdown and capture baseline.
 */
async function countdownAndCapture(
  socket: Socket,
  session: SessionState,
  frameDataUrl: string
): Promise<void> {
  // Countdown 3, 2, 1
  for (let i = 3; i >= 1; i--) {
    session.countdown = i;
    socket.emit("state", toClientState(session));
    await sleep(1000);
  }

  // Capture baseline
  session.countdown = null;
  session.phase = "baseline";
  socket.emit("state", toClientState(session));

  // Store baseline frame and advance to first challenge
  session.baselineFrame = frameDataUrl;
  session.phase = "challenging";
  session.challenge = {
    type: session.challenges[0],
    index: 0,
    total: session.challenges.length,
    progress: 0,
    hint: getHintForChallenge(session.challenges[0]),
  };

  socket.emit("state", toClientState(session));
}

/**
 * Handle baseline phase (usually automatic after countdown).
 */
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
  socket.emit("state", toClientState(session));
}

/**
 * Handle challenge phase - evaluate current challenge.
 */
function handleChallengePhase(
  socket: Socket,
  session: SessionState,
  result: Awaited<ReturnType<typeof detectFromBase64>>,
  face: ReturnType<typeof getPrimaryFace>,
  frameDataUrl: string
): void {
  // Check challenge timeout
  if (isChallengeExpired(session)) {
    session.phase = "failed";
    socket.emit("failed", {
      code: "challenge_timeout",
      message: "Challenge timed out",
      canRetry: true,
    });
    return;
  }

  if (!face) {
    resetChallengePass(session);
    session.phase = "detecting";
    socket.emit("state", {
      ...toClientState(session),
      hint: "Face lost - position your face in the frame",
    });
    return;
  }

  const challengeType = session.challenges[session.currentIndex];
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
        socket.emit("state", {
          ...toClientState(session),
          hint: "Verifying...",
        });
      } else {
        // Next challenge
        const nextType = session.challenges[session.currentIndex];
        session.challenge = {
          type: nextType,
          index: session.currentIndex,
          total: session.challenges.length,
          progress: 0,
          hint: getHintForChallenge(nextType),
        };
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

/**
 * Handle verifying phase - final anti-spoof checks.
 */
function handleVerifyingPhase(
  socket: Socket,
  session: SessionState,
  _result: Awaited<ReturnType<typeof detectFromBase64>>,
  face: ReturnType<typeof getPrimaryFace>,
  log: Logger
): void {
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
  const livenessPassed = liveScore >= 0.5;

  if (!(antispoofPassed && livenessPassed)) {
    session.phase = "failed";
    socket.emit("failed", {
      code: antispoofPassed ? "liveness_failed" : "antispoof_failed",
      message: "Verification failed - please try again with a live camera",
      canRetry: true,
    });
    return;
  }

  // Success! Send with acknowledgment to ensure client receives it.
  session.phase = "completed";
  const completionData = {
    verified: true,
    sessionId: session.id,
    selfieImage: session.baselineFrame || "",
    confidence: Math.min(realScore, liveScore),
    antispoofPassed,
    livenessPassed,
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

/**
 * Evaluate if current challenge is passed.
 */
function evaluateChallenge(
  type: string,
  face: NonNullable<ReturnType<typeof getPrimaryFace>>,
  result: Awaited<ReturnType<typeof detectFromBase64>>,
  session: SessionState
): { passed: boolean; progress: number; hint: string } {
  if (type === "smile") {
    return evaluateSmile(face, session);
  }
  return evaluateTurn(type, face, result, session);
}

/**
 * Evaluate smile challenge.
 */
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

/**
 * Evaluate turn challenge.
 */
function evaluateTurn(
  type: string,
  face: NonNullable<ReturnType<typeof getPrimaryFace>>,
  result: Awaited<ReturnType<typeof detectFromBase64>>,
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

/**
 * Get initial hint for a challenge type.
 */
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

/**
 * Simple sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
