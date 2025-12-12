/**
 * Shared liveness thresholds/policy.
 *
 * Keep these constants in sync across:
 * - Client liveness UX (StepSelfie)
 * - Server liveness verification (/api/liveness/verify)
 */

export const SMILE_SCORE_THRESHOLD = 0.6;
export const SMILE_DELTA_THRESHOLD = 0.1;
export const SMILE_HIGH_THRESHOLD = 0.85;

export const BASELINE_CENTERED_THRESHOLD_DEG = 10;
export const TURN_YAW_ABSOLUTE_THRESHOLD_DEG = 18;
export const TURN_YAW_SIGNIFICANT_DELTA_DEG = 20;
