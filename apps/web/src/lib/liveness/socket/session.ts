/**
 * Liveness session state management.
 *
 * Each socket connection gets a session that tracks challenge progress.
 * All state is in-memory (no Redis for now).
 */

import type { ChallengeType } from "../challenges";

import { randomInt } from "node:crypto";

// Session phases (simple state machine)
export type SessionPhase =
  | "connecting"
  | "detecting" // Looking for face
  | "countdown" // 3-2-1 before baseline
  | "baseline" // Capturing neutral face
  | "challenging" // Active challenge
  | "capturing" // Storing challenge frame
  | "verifying" // Final checks
  | "completed" // Success
  | "failed"; // Failure

export interface ChallengeState {
  type: ChallengeType;
  index: number;
  total: number;
  progress: number; // 0-100
  hint: string | null;
}

export interface FaceState {
  detected: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
}

export interface SessionState {
  id: string;
  phase: SessionPhase;
  challenge: ChallengeState | null;
  face: FaceState;
  countdown: number | null;

  // Internal tracking
  challenges: ChallengeType[];
  currentIndex: number;
  consecutiveFaceDetections: number;
  consecutiveChallengeDetections: number;
  baselineHappy: number | null;
  lastHappyScore: number | null;
  turnStartYaw: number | null;
  turnCentered: boolean;
  countdownAwaitingClient: boolean;
  countdownRequestedAt: number | null;
  pendingBaselineFrame: string | null;
  lastFrameDataUrl: string | null;
  challengeAwaitingClient: boolean;
  challengeRequestedAt: number | null;
  challengeStartedAt: number | null;

  // Captured frames (base64)
  baselineFrame: string | null;
  challengeFrames: Map<ChallengeType, string>;

  // Timing
  startedAt: number;
  lastFrameAt: number;

  // Retry tracking
  retryCount: number;

  // Configurable timeouts
  timeouts: SessionTimeouts;
}

// Constants - consecutive frames needed for stable detection
// Reduced from 3 to 2 for faster response (~200ms at 10 FPS)
const STABILITY_FRAMES = 2;

/**
 * Configurable timeout settings for liveness sessions.
 */
export interface SessionTimeouts {
  /** Maximum session duration in milliseconds */
  sessionTimeoutMs: number;
  /** Maximum time per challenge in milliseconds */
  challengeTimeoutMs: number;
  /** Countdown duration in milliseconds */
  countdownDurationMs: number;
}

export const DEFAULT_TIMEOUTS: SessionTimeouts = {
  sessionTimeoutMs: 60_000, // 60 seconds max
  challengeTimeoutMs: 15_000, // 15 seconds per challenge
  countdownDurationMs: 2000, // 2 second countdown (reduced from 3)
};

// Challenge limits (security: prevent DoS via excessive challenges)
// Cap to available unique challenges to avoid repeats in a single session.
const MIN_CHALLENGES = 1;
const MAX_CHALLENGES = 3;

/**
 * Create a new session with random challenges.
 */
export function createSession(
  numChallenges = 2,
  timeouts: Partial<SessionTimeouts> = {}
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

/**
 * Generate random challenge sequence using cryptographically secure randomness.
 */
function generateChallenges(count: number): ChallengeType[] {
  const pool: ChallengeType[] = ["smile", "turn_left", "turn_right"];

  // Fisher-Yates shuffle with crypto.randomInt for unpredictability
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const challenges = shuffled.slice(0, count);

  // Ensure at least one turn for better security
  if (!challenges.some((c) => c.startsWith("turn"))) {
    const replaceIndex = randomInt(challenges.length);
    challenges[replaceIndex] = randomInt(2) === 0 ? "turn_left" : "turn_right";
  }

  return challenges;
}

/**
 * Get the current challenge info for client.
 */
export function getCurrentChallenge(
  session: SessionState
): ChallengeState | null {
  if (session.phase !== "challenging" && session.phase !== "capturing") {
    return null;
  }

  const type = session.challenges[session.currentIndex];
  if (!type) {
    return null;
  }

  return {
    type,
    index: session.currentIndex,
    total: session.challenges.length,
    progress: 0, // Will be updated by detection
    hint: null,
  };
}

/**
 * Check if session has timed out.
 */
export function isSessionExpired(session: SessionState): boolean {
  const elapsed = Date.now() - session.startedAt;
  return elapsed > session.timeouts.sessionTimeoutMs;
}

/**
 * Check if current challenge has timed out.
 */
export function isChallengeExpired(session: SessionState): boolean {
  if (session.phase !== "challenging") {
    return false;
  }
  if (!session.challengeStartedAt) {
    return false;
  }
  const elapsed = Date.now() - session.challengeStartedAt;
  return elapsed > session.timeouts.challengeTimeoutMs;
}

/**
 * Record a successful face detection.
 */
export function recordFaceDetection(session: SessionState): number {
  session.consecutiveFaceDetections++;
  return session.consecutiveFaceDetections;
}

/**
 * Reset face detection counter.
 */
export function resetFaceDetection(session: SessionState): void {
  session.consecutiveFaceDetections = 0;
}

/**
 * Record a successful challenge pass.
 */
export function recordChallengePass(session: SessionState): number {
  session.consecutiveChallengeDetections++;
  return session.consecutiveChallengeDetections;
}

/**
 * Reset challenge pass counter.
 */
export function resetChallengePass(session: SessionState): void {
  session.consecutiveChallengeDetections = 0;
}

/**
 * Check if we have enough consecutive detections.
 */
export function hasStableDetection(session: SessionState): boolean {
  return session.consecutiveFaceDetections >= STABILITY_FRAMES;
}

/**
 * Check if challenge has been passed stably.
 */
export function hasStableChallengePass(session: SessionState): boolean {
  return session.consecutiveChallengeDetections >= STABILITY_FRAMES;
}

/**
 * Advance to the next challenge or complete.
 */
export function advanceChallenge(session: SessionState): boolean {
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

/**
 * Get serializable state for client.
 */
export function toClientState(session: SessionState): {
  id: string;
  phase: SessionPhase;
  challenge: ChallengeState | null;
  face: FaceState;
  countdown: number | null;
} {
  return {
    id: session.id,
    phase: session.phase,
    // Use session.challenge directly - it has the actual progress and hint values
    // that are updated during challenge evaluation
    challenge: session.challenge,
    face: session.face,
    countdown: session.countdown,
  };
}
