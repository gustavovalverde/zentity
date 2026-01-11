/**
 * Virtual camera detection for liveness security.
 * Filters out known screen capture and virtual camera software.
 *
 * Based on AWS Amplify FaceLivenessDetector patterns.
 */

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

/**
 * Check if a device appears to be a virtual camera.
 */
export function isVirtualCamera(device: MediaDeviceInfo): boolean {
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

/**
 * Check if a device appears to be screen capture.
 */
export function isScreenCapture(device: MediaDeviceInfo): boolean {
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

/**
 * Filter devices to only include physical cameras.
 */
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

export interface VirtualCameraCheckResult {
  isVirtual: boolean;
  reason?: "virtual_camera" | "screen_capture";
  deviceLabel?: string;
}

/**
 * Check a specific device for virtual camera indicators.
 */
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

/**
 * Get human-readable message for virtual camera detection.
 */
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
