/**
 * Liveness Detection Types
 *
 * Shared type definitions for the liveness detection flow.
 */

import type { Human } from "@vladmandic/human";
import type { ChallengeType } from "@/lib/liveness/liveness-challenges";

/**
 * State machine states for the liveness challenge flow.
 */
export type ChallengeState =
  | "idle"
  | "loading_session"
  | "detecting"
  | "countdown"
  | "preparing_challenge"
  | "waiting_challenge"
  | "capturing"
  | "validating"
  | "challenge_passed"
  | "all_passed"
  | "failed"
  | "timeout";

/**
 * Direction the user's face is facing.
 */
type FacingDirection = "left" | "right" | "center";

/**
 * Debug frame data for development overlay.
 */
export interface LivenessDebugFrame {
  ts: number;
  state: ChallengeState;
  faceDetected: boolean;
  happy: number;
  baselineHappy: number;
  deltaHappy: number;
  yawDeg: number;
  dir: FacingDirection;
  headTurnCentered: boolean;
  consecutiveDetections: number;
  consecutiveChallengeDetections: number;
  videoWidth: number;
  videoHeight: number;
  gesture: string[];
  /** Performance metrics from Human.js */
  performance?: {
    detect?: number;
    total?: number;
  };
}

/**
 * Server-created liveness session.
 */
export interface LivenessSession {
  sessionId: string;
  challenges: ChallengeType[];
}

/**
 * Real-time progress from server via SSE.
 */
export interface ServerProgress {
  faceDetected: boolean;
  progress: number;
  passed: boolean;
  hint?: string;
  happy?: number;
  yaw?: number;
  direction?: string;
}

/**
 * Arguments for the useSelfieLivenessFlow hook.
 */
export interface UseSelfieLivenessFlowArgs {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureFrame: () => string | null;
  /** Optional optimized frame capture for streaming (smaller, lower quality) */
  captureStreamFrame?: () => string | null;
  /** Optional square-padded canvas for improved face detection accuracy */
  getSquareDetectionCanvas?: () => HTMLCanvasElement | null;
  human: Human | null;
  humanReady: boolean;
  debugEnabled: boolean;
  initialSelfieImage?: string | null;
  onVerified: (args: {
    selfieImage: string;
    bestSelfieFrame: string;
    blinkCount: number | null;
  }) => void;
  onReset: () => void;
  /** Called when session error occurs (expired session), allowing component to reset wizard */
  onSessionError?: () => void;
}
