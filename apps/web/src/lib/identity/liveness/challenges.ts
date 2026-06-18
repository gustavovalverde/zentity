/**
 * Liveness wire contract: the types the client and server both speak.
 *
 * Directive-free on purpose. The server engine (session.ts, `server-only`) and
 * the client transport hook both import these, so this file must carry neither
 * `server-only` nor `"use client"`.
 */

import type { LivenessErrorState } from "./errors";

export type ChallengeType = "smile" | "turn_left" | "turn_right";

/**
 * Active phases the server engine drives. The client also models "connecting"
 * (pre-session) locally; terminal outcomes are carried by LivenessResult /
 * LivenessFailure rather than as snapshot phases.
 */
export type LivenessPhase =
  | "detecting"
  | "countdown"
  | "challenging"
  | "verifying";

export interface ChallengeState {
  hint: string | null;
  index: number;
  progress: number;
  total: number;
  type: ChallengeType;
}

export interface FaceState {
  box: { x: number; y: number; width: number; height: number } | null;
  detected: boolean;
}

/** Per-frame state returned while the flow is in progress. */
export interface LivenessSnapshot {
  challenge: ChallengeState | null;
  countdown: number | null;
  face: FaceState;
  hint?: string;
  phase: LivenessPhase;
}

/** Terminal success. selfieImage is the exact baseline frame the server scored. */
export interface LivenessResult {
  confidence: number;
  draftUpdated: boolean;
  phase: "completed";
  selfieImage: string;
  verified: true;
}

/** Terminal failure (anti-spoof, timeout). A valid liveness outcome, not an HTTP error. */
export interface LivenessFailure {
  canRetry: boolean;
  code: LivenessErrorState;
  message: string;
  phase: "failed";
}

/** The single value advanceFrame returns and the frame route serializes. */
export type AdvanceResult = LivenessSnapshot | LivenessResult | LivenessFailure;

export interface FaceMatchResult {
  confidence: number;
  distance: number;
  error?: string | undefined;
  idFaceExtracted: boolean;
  idFaceImage?: string | undefined;
  matched: boolean;
  processingTimeMs: number;
  threshold: number;
}
