/**
 * Liveness Detection Module - Client-Safe Exports
 *
 * This barrel file only exports modules that are safe for client components.
 * For server-only liveness utilities (human-server, face-detection,
 * liveness-session-store), import directly from the specific module files.
 */

// Challenge types and instructions (client-safe, just data)
export type { ChallengeInfo, ChallengeType } from "./liveness-challenges";

export { CHALLENGE_INSTRUCTIONS } from "./liveness-challenges";
// Debug utilities (client-safe)
export { getLivenessDebugEnabled } from "./liveness-debug";
// Policy thresholds (client-safe, just constants)
export {
  ANTISPOOF_LIVE_THRESHOLD,
  ANTISPOOF_REAL_THRESHOLD,
  BASELINE_CENTERED_THRESHOLD_DEG,
  FACE_MATCH_MIN_CONFIDENCE,
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "./liveness-policy";
