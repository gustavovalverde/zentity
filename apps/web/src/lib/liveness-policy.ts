/**
 * Shared liveness thresholds/policy.
 *
 * Keep these constants in sync across:
 * - Client liveness UX (StepSelfie)
 * - Server liveness verification (tRPC `liveness.verify`)
 */

// Thresholds raised because tfjs-node detects ~70-80% "happy" on neutral faces
export const SMILE_SCORE_THRESHOLD = 0.8; // Require 80%+ happy score
export const SMILE_DELTA_THRESHOLD = 0.25; // Require 25% increase from baseline
export const SMILE_HIGH_THRESHOLD = 0.95; // Auto-pass at 95%+ (definitive smile)

export const BASELINE_CENTERED_THRESHOLD_DEG = 10;
// Head turn is intentionally kept modest for UX; many cameras + face models
// under-estimate yaw degrees in real-world lighting.
export const TURN_YAW_ABSOLUTE_THRESHOLD_DEG = 12;
export const TURN_YAW_SIGNIFICANT_DELTA_DEG = 12;

// Anti-spoofing thresholds for baseline image validation
// - REAL: Antispoof model detects 3D face vs 2D photo/screen. Keep strict.
// - LIVE: Disabled (0) because tfjs-node liveness model gives ~3% on single frames.
//   Gesture challenges (smile, head turns) prove liveness far more reliably.
export const ANTISPOOF_REAL_THRESHOLD = 0.5;
export const ANTISPOOF_LIVE_THRESHOLD = 0;
