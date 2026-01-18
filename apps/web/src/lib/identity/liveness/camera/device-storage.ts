/**
 * Camera device persistence for liveness detection.
 * Remembers user's preferred camera across sessions.
 *
 * Based on AWS Amplify FaceLivenessDetector patterns.
 */

const STORAGE_KEY = "zentity-liveness-camera-device";

export interface StoredCameraPreference {
  /** Device ID of the preferred camera */
  deviceId: string;
  /** Human-readable label of the camera */
  label: string;
  /** Timestamp when preference was saved */
  lastUsed: number;
}

/**
 * Save the user's preferred camera to localStorage.
 */
export function savePreferredCamera(device: MediaDeviceInfo): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    const preference: StoredCameraPreference = {
      deviceId: device.deviceId,
      label: device.label,
      lastUsed: Date.now(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // localStorage may be unavailable or full
  }
}

/**
 * Get the user's previously saved camera preference.
 */
function getPreferredCamera(): StoredCameraPreference | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const preference = JSON.parse(stored) as StoredCameraPreference;

    // Validate structure
    if (!preference.deviceId || typeof preference.deviceId !== "string") {
      return null;
    }

    return preference;
  } catch {
    return null;
  }
}

/**
 * Find the preferred device from a list of available devices.
 */
export function findPreferredDevice(
  devices: MediaDeviceInfo[]
): MediaDeviceInfo | null {
  const preference = getPreferredCamera();
  if (!preference) {
    return null;
  }

  return devices.find((d) => d.deviceId === preference.deviceId) ?? null;
}
