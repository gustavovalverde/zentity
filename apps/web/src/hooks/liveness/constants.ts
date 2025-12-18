/**
 * Liveness Detection Constants
 *
 * Configuration values for the liveness detection flow.
 * These are tuned for optimal user experience and security.
 */

/** Interval between face detection checks during the flow (ms). */
export const DETECTION_INTERVAL = 300;

/** Number of consecutive detections required to confirm stable face presence. */
export const STABILITY_FRAMES = 3;

/** Maximum time to complete each challenge gesture (ms). */
export const CHALLENGE_TIMEOUT = 10_000;

/** Maximum time to detect initial face before timeout (ms). */
export const FACE_TIMEOUT = 30_000;

/** Yaw angle deadzone (degrees) - face must be within this to be "centered". */
export const HEAD_CENTER_THRESHOLD = 5;

/** Number of random challenges to present (from: smile, turn_left, turn_right). */
export const NUM_CHALLENGES = 2;

/** Delay to show "passed" feedback before moving to next challenge (ms). */
export const CHALLENGE_PASSED_DELAY = 1000;

/** Delay for user to prepare before next challenge timer starts (ms). */
export const CHALLENGE_PREP_DELAY = 2000;

/** Server-side verification timeout - prevents UI from getting stuck (ms). */
export const VERIFY_TIMEOUT = 20_000;

/** Frame streaming interval for server hints - avoids piling up requests (ms). */
export const FRAME_STREAM_INTERVAL = 300;
