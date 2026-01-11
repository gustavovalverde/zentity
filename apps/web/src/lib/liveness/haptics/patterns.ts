/**
 * Haptic feedback patterns for liveness detection.
 * Uses the Vibration API to provide tactile feedback on mobile devices.
 *
 * Pattern arrays: [vibrate, pause, vibrate, pause, ...]
 * - Numbers represent milliseconds
 * - Odd indices = vibration duration
 * - Even indices (after first) = pause duration
 */

export type HapticType =
  | "faceDetected"
  | "faceLost"
  | "challengeProgress"
  | "challengePassed"
  | "verificationComplete"
  | "error"
  | "countdown"
  | "countdown3"
  | "countdown2"
  | "countdown1";

/**
 * Vibration patterns for each feedback event.
 *
 * Design principles:
 * - Short pulses = quick acknowledgment
 * - Double pulses = warning/attention
 * - Ascending patterns = success
 * - Long pulses = important events
 */
export const HAPTIC_PATTERNS: Record<HapticType, number | number[]> = {
  /**
   * Face detected - single short pulse
   * Subtle confirmation that face entered frame
   */
  faceDetected: 50,

  /**
   * Face lost - double pulse warning
   * Distinct pattern to alert user without being alarming
   */
  faceLost: [30, 50, 30],

  /**
   * Challenge progress - micro tick
   * Very subtle feedback for progress milestones
   */
  challengeProgress: 20,

  /**
   * Challenge passed - ascending pattern
   * Satisfying "completed" feeling
   */
  challengePassed: [50, 30, 80],

  /**
   * Verification complete - celebration pattern
   * Distinctive "fanfare" pattern
   */
  verificationComplete: [100, 50, 100, 50, 150],

  /**
   * Error - long warning pattern
   * Clearly different from success patterns
   */
  error: [200, 100, 200],

  /**
   * Countdown tick - quick pulse
   * Used for 3, 2, 1 countdown
   */
  countdown: 30,

  /**
   * Countdown 3 - triple pulse
   */
  countdown3: [30, 40, 30, 40, 30],

  /**
   * Countdown 2 - double pulse
   */
  countdown2: [40, 50, 40],

  /**
   * Countdown 1 - single longer pulse
   */
  countdown1: 60,
};

/**
 * Trigger haptic feedback with the specified pattern.
 * @returns true if vibration was triggered, false if not supported
 */
export function vibrate(pattern: number | number[]): boolean {
  if (!isHapticsSupported()) {
    return false;
  }

  try {
    navigator.vibrate(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop any ongoing vibration.
 */
export function stopVibration(): void {
  if (isHapticsSupported()) {
    navigator.vibrate(0);
  }
}

/**
 * Check if haptic feedback is supported on this device.
 */
export function isHapticsSupported(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

/**
 * Trigger haptic feedback by event type.
 */
export function triggerHaptic(type: HapticType): boolean {
  const pattern = HAPTIC_PATTERNS[type];
  return vibrate(pattern);
}
