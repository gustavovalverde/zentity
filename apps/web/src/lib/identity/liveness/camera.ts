/**
 * Camera hardware validation for liveness detection.
 *
 * Covers three concerns:
 * - Device preference persistence (remember user's chosen camera)
 * - Frame rate validation (enforce minimum 15 FPS)
 * - Virtual/screen-capture detection (reject non-physical cameras)
 *
 * Based on AWS Amplify FaceLivenessDetector patterns.
 */

// ---------------------------------------------------------------------------
// Device preference persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "zentity-liveness-camera-device";

interface StoredCameraPreference {
  /** Device ID of the preferred camera */
  deviceId: string;
  /** Human-readable label of the camera */
  label: string;
  /** Timestamp when preference was saved */
  lastUsed: number;
}

/** Save the user's preferred camera to localStorage. */
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

    if (!preference.deviceId || typeof preference.deviceId !== "string") {
      return null;
    }

    return preference;
  } catch {
    return null;
  }
}

/** Find the preferred device from a list of available devices. */
export function findPreferredDevice(
  devices: MediaDeviceInfo[]
): MediaDeviceInfo | null {
  const preference = getPreferredCamera();
  if (!preference) {
    return null;
  }

  return devices.find((d) => d.deviceId === preference.deviceId) ?? null;
}

// ---------------------------------------------------------------------------
// Frame rate validation
// ---------------------------------------------------------------------------

/** Minimum frame rate required for reliable liveness detection */
export const MIN_FRAMERATE = 15;

interface FrameRateValidation {
  /** Actual frame rate reported by the camera */
  actualFrameRate: number;
  /** Raw capabilities from the track, if available */
  capabilities?: MediaTrackCapabilities | undefined;
  /** Whether the frame rate meets minimum requirements */
  isValid: boolean;
  /** Minimum frame rate required */
  minRequired: number;
}

/** Validate that a media stream meets minimum frame rate requirements. */
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

  const settings = track.getSettings();
  const actualFrameRate = settings.frameRate ?? 0;

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

/** Get a human-readable message about frame rate issues. */
export function getFrameRateMessage(validation: FrameRateValidation): string {
  if (validation.isValid) {
    return "";
  }

  const actualFps = validation.actualFrameRate.toFixed(1);
  const minFps = validation.minRequired;

  return `Camera frame rate (${actualFps} FPS) is below the minimum required (${minFps} FPS). Try closing other apps or using a different camera.`;
}

// ---------------------------------------------------------------------------
// Virtual/screen-capture detection
// ---------------------------------------------------------------------------

/** Known virtual camera software patterns (case-insensitive) */
const VIRTUAL_CAMERA_PATTERNS = [
  // OBS and derivatives
  "obs virtual",
  "obs-camera",
  "obs studio",
  // Popular virtual camera apps
  "manycam",
  "snap camera",
  "snapcam",
  "xsplit",
  "camtwist",
  "mmhmm",
  "e2esoft",
  "splitcam",
  "youcam",
  "logi capture",
  "logitech capture",
  // AI/filter cameras
  "nvidia broadcast",
  "krisp",
  // Generic patterns
  "virtual cam",
  "virtual camera",
  "vcam",
  "fake camera",
  "dummy",
  // NDI
  "ndi",
  // Screen capture
  "screen capture",
  "screencapture",
];

/** Screen sharing device patterns */
const SCREEN_SHARE_PATTERNS = [
  "screen",
  "display",
  "monitor",
  "window capture",
  "desktop",
];

function isVirtualCamera(device: MediaDeviceInfo): boolean {
  if (!device.label) {
    // Can't determine without label - allow by default
    // (labels require getUserMedia permission first)
    return false;
  }

  const label = device.label.toLowerCase();

  for (const pattern of VIRTUAL_CAMERA_PATTERNS) {
    if (label.includes(pattern)) {
      return true;
    }
  }

  return false;
}

function isScreenCapture(device: MediaDeviceInfo): boolean {
  if (!device.label) {
    return false;
  }

  const label = device.label.toLowerCase();

  for (const pattern of SCREEN_SHARE_PATTERNS) {
    if (label.includes(pattern)) {
      return true;
    }
  }

  return false;
}

/** Filter devices to only include physical cameras. */
export function filterPhysicalCameras(
  devices: MediaDeviceInfo[]
): MediaDeviceInfo[] {
  return devices.filter((device) => {
    if (device.kind !== "videoinput") {
      return false;
    }
    if (isVirtualCamera(device)) {
      return false;
    }
    if (isScreenCapture(device)) {
      return false;
    }
    return true;
  });
}

interface VirtualCameraCheckResult {
  deviceLabel?: string;
  isVirtual: boolean;
  reason?: "virtual_camera" | "screen_capture";
}

/** Check a specific device for virtual camera indicators. */
export function checkForVirtualCamera(
  device: MediaDeviceInfo
): VirtualCameraCheckResult {
  if (isVirtualCamera(device)) {
    return {
      isVirtual: true,
      reason: "virtual_camera",
      deviceLabel: device.label,
    };
  }

  if (isScreenCapture(device)) {
    return {
      isVirtual: true,
      reason: "screen_capture",
      deviceLabel: device.label,
    };
  }

  return { isVirtual: false };
}

/** Get human-readable message for virtual camera detection. */
export function getVirtualCameraMessage(
  result: VirtualCameraCheckResult
): string {
  if (!result.isVirtual) {
    return "";
  }

  if (result.reason === "screen_capture") {
    return "Screen capture devices are not allowed for liveness verification.";
  }

  return "Virtual cameras are not allowed for liveness verification. Please use a physical camera.";
}
