/**
 * Frame rate validation for liveness detection.
 * Ensures camera meets minimum requirements for reliable detection.
 *
 * Based on AWS Amplify FaceLivenessDetector patterns.
 */

/** Minimum frame rate required for reliable liveness detection */
export const MIN_FRAMERATE = 15;

export interface FrameRateValidation {
  /** Whether the frame rate meets minimum requirements */
  isValid: boolean;
  /** Actual frame rate reported by the camera */
  actualFrameRate: number;
  /** Minimum frame rate required */
  minRequired: number;
  /** Raw capabilities from the track, if available */
  capabilities?: MediaTrackCapabilities;
}

/**
 * Validate that a media stream meets minimum frame rate requirements.
 */
export function validateFrameRate(
  stream: MediaStream,
  minFrameRate: number = MIN_FRAMERATE
): FrameRateValidation {
  const track = stream.getVideoTracks()[0];

  if (!track) {
    return {
      isValid: false,
      actualFrameRate: 0,
      minRequired: minFrameRate,
    };
  }

  // Get current settings (what's actually being delivered)
  const settings = track.getSettings();
  const actualFrameRate = settings.frameRate ?? 0;

  // Get capabilities (what the device can do) if available
  let capabilities: MediaTrackCapabilities | undefined;
  if (typeof track.getCapabilities === "function") {
    try {
      capabilities = track.getCapabilities();
    } catch {
      // getCapabilities may throw in some browsers
    }
  }

  const isValid = actualFrameRate >= minFrameRate;

  return {
    isValid,
    actualFrameRate,
    minRequired: minFrameRate,
    capabilities,
  };
}

/**
 * Attempt to apply minimum frame rate constraint to a track.
 * Returns true if the constraint was applied successfully.
 */
export async function requestMinFrameRate(
  track: MediaStreamTrack,
  minFrameRate: number = MIN_FRAMERATE
): Promise<boolean> {
  try {
    await track.applyConstraints({
      frameRate: { min: minFrameRate },
    });
    return true;
  } catch {
    // Constraint couldn't be met by this device
    return false;
  }
}

/**
 * Get a human-readable message about frame rate issues.
 */
export function getFrameRateMessage(validation: FrameRateValidation): string {
  if (validation.isValid) {
    return "";
  }

  const actualFps = validation.actualFrameRate.toFixed(1);
  const minFps = validation.minRequired;

  return `Camera frame rate (${actualFps} FPS) is below the minimum required (${minFps} FPS). Try closing other apps or using a different camera.`;
}

/**
 * Check if frame rate can potentially be improved.
 */
export function canImproveFrameRate(validation: FrameRateValidation): boolean {
  if (validation.isValid) {
    return false;
  }

  // Check if capabilities indicate higher frame rate is possible
  if (validation.capabilities?.frameRate) {
    const maxCapable =
      typeof validation.capabilities.frameRate === "object"
        ? validation.capabilities.frameRate.max
        : validation.capabilities.frameRate;

    if (maxCapable && maxCapable >= validation.minRequired) {
      return true;
    }
  }

  return false;
}
