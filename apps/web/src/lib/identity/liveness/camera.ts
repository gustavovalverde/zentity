"use client";

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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { reportRejection } from "@/lib/async-handler";

import { LivenessErrorState } from "./errors";

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
function savePreferredCamera(device: MediaDeviceInfo): void {
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
function findPreferredDevice(
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
const MIN_FRAMERATE = 15;

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
function validateFrameRate(
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
function getFrameRateMessage(validation: FrameRateValidation): string {
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
function filterPhysicalCameras(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
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
function checkForVirtualCamera(
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
function getVirtualCameraMessage(result: VirtualCameraCheckResult): string {
  if (!result.isVirtual) {
    return "";
  }

  if (result.reason === "screen_capture") {
    return "Screen capture devices are not allowed for liveness verification.";
  }

  return "Virtual cameras are not allowed for liveness verification. Please use a physical camera.";
}

// ---------------------------------------------------------------------------
// Camera hook
// ---------------------------------------------------------------------------

type PermissionState = "checking" | "granted" | "denied" | "prompt";

// Regex for detecting mobile user agents - defined at module level for performance
const MOBILE_UA_REGEX =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

/**
 * Detect if device is mobile using multiple signals.
 * Used for UI decisions (fullscreen mode), NOT for quality/performance branching.
 */
function detectIsMobile(): boolean {
  if (globalThis.window === undefined) {
    return false;
  }
  const hasTouch = "ontouchstart" in globalThis || navigator.maxTouchPoints > 0;
  const isSmallScreen = globalThis.window.innerWidth < 768;
  const mobileUA = MOBILE_UA_REGEX.test(navigator.userAgent);
  return (hasTouch && isSmallScreen) || mobileUA;
}

interface UseCameraOptions {
  /** Block virtual cameras (OBS, ManyCam, etc.) for security. Default: true */
  blockVirtualCameras?: boolean;
  /** Target brightness for correction (0-255) */
  brightnessTarget?: number;
  facingMode?: "user" | "environment";
  /** Ideal video height */
  idealHeight?: number;
  /** Ideal video width */
  idealWidth?: number;
  /** Minimum required frame rate. Default: 15 */
  minFrameRate?: number;
  /** Remember selected camera across sessions. Default: true */
  rememberDevice?: boolean;
  /** Skip brightness correction */
  skipBrightnessCorrection?: boolean;
  /** Validate frame rate meets minimum. Default: true */
  validateFrameRateOption?: boolean;
}

interface UseCameraResult {
  /** Available camera devices (physical cameras only if blockVirtualCameras is true) */
  availableDevices: MediaDeviceInfo[];
  /** Camera-related error state, if any */
  cameraError: LivenessErrorState | null;
  /** Human-readable camera error message */
  cameraErrorMessage: string | null;
  captureFrame: () => string | null;
  /** Capture frame optimized for streaming (smaller size, lower quality) */
  captureStreamFrame: () => string | null;
  /** Enumerate available camera devices */
  enumerateDevices: () => Promise<MediaDeviceInfo[]>;
  /** Whether device is mobile (for UI decisions like fullscreen) */
  isMobile: boolean;
  isStreaming: boolean;
  permissionStatus: PermissionState;
  /** Select a specific camera device */
  selectDevice: (deviceId: string | null) => void;
  /** Currently selected device ID */
  selectedDeviceId: string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

/**
 * Shared camera hook for liveness and document capture.
 * Manages permissions, stream lifecycle, and frame capture.
 *
 * Same settings for mobile and desktop - no platform-specific branching.
 * Frames sent to server are capped at 640px anyway (see useLiveness).
 */
export function useCamera(options: UseCameraOptions = {}): UseCameraResult {
  const {
    facingMode = "user",
    idealWidth = 640,
    idealHeight = 480,
    brightnessTarget = 110,
    skipBrightnessCorrection = false,
    blockVirtualCameras = true,
    validateFrameRateOption = true,
    minFrameRate = MIN_FRAMERATE,
    rememberDevice = true,
  } = options;

  // Detect mobile for UI decisions only (e.g., fullscreen mode)
  const isMobile = useMemo(() => detectIsMobile(), []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Single pooled canvas for all capture operations (saves ~2.4MB vs 3 separate canvases)
  const canvasPoolRef = useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    width: number;
    height: number;
  } | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionState>("checking");

  // New state for device management
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>(
    []
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<LivenessErrorState | null>(
    null
  );
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(
    null
  );

  // Check permission once on mount and watch for changes.
  useEffect(() => {
    let cancelled = false;
    let permission: PermissionStatus | null = null;
    const handleChange = () => {
      if (cancelled || !permission) {
        return;
      }
      setPermissionStatus(permission.state as PermissionState);
    };
    async function checkPermission() {
      try {
        if (!navigator.permissions) {
          if (!cancelled) {
            setPermissionStatus("prompt");
          }
          return;
        }
        const result = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        permission = result;
        if (!cancelled) {
          setPermissionStatus(result.state as PermissionState);
          result.addEventListener("change", handleChange);
        }
      } catch {
        if (!cancelled) {
          setPermissionStatus("prompt");
        }
      }
    }
    checkPermission().catch(reportRejection);
    return () => {
      cancelled = true;
      permission?.removeEventListener("change", handleChange);
    };
  }, []);

  /**
   * Enumerate available camera devices with optional virtual camera filtering.
   * Also restores previously selected camera if available.
   */
  const enumerateDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      let videoDevices = devices.filter((d) => d.kind === "videoinput");

      // Filter out virtual cameras if enabled
      if (blockVirtualCameras) {
        videoDevices = filterPhysicalCameras(videoDevices);
      }

      setAvailableDevices(videoDevices);

      // Restore preferred device if available and enabled
      if (rememberDevice) {
        const preferred = findPreferredDevice(videoDevices);
        if (preferred) {
          setSelectedDeviceId(preferred.deviceId);
        }
      }

      return videoDevices;
    } catch (error) {
      console.warn("Failed to enumerate devices:", error);
      return [];
    }
  }, [blockVirtualCameras, rememberDevice]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        // ignore pause errors
      }
      video.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      // Clear any previous errors
      setCameraError(null);
      setCameraErrorMessage(null);

      // Ensure any existing stream is fully released before requesting a new one.
      stopCamera();

      // Build constraints - same for all devices
      const constraints: MediaStreamConstraints = {
        video: {
          // Use selected device if available, otherwise use facingMode
          ...(selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : { facingMode }),
          width: { ideal: idealWidth },
          height: { ideal: idealHeight },
        },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (constraintError) {
        // Fallback: try with minimal constraints if specific ones fail
        console.warn(
          "Camera constraints failed, retrying with minimal constraints:",
          constraintError
        );
        stream = await navigator.mediaDevices.getUserMedia({
          video: selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : { facingMode },
        });
      }

      const video = videoRef.current;
      if (!video) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      // Validate frame rate if enabled
      if (validateFrameRateOption) {
        const fpsValidation = validateFrameRate(stream, minFrameRate);
        if (!fpsValidation.isValid) {
          const message = getFrameRateMessage(fpsValidation);
          setCameraError(LivenessErrorState.CAMERA_FRAMERATE_ERROR);
          setCameraErrorMessage(message);
          // Continue anyway but warn - don't block completely
          console.warn("Frame rate below minimum:", fpsValidation);
        }
      }

      // Check for virtual camera if blocking is enabled
      if (blockVirtualCameras) {
        const track = stream.getVideoTracks()[0];
        if (track) {
          const settings = track.getSettings();
          // Find the device by matching deviceId from settings
          const devices = availableDevices.length
            ? availableDevices
            : await navigator.mediaDevices
                .enumerateDevices()
                .then((d) => d.filter((dev) => dev.kind === "videoinput"));

          const device = devices.find((d) => d.deviceId === settings.deviceId);

          if (device) {
            const virtualCheck = checkForVirtualCamera(device);
            if (virtualCheck.isVirtual) {
              // Stop the stream and throw error
              for (const t of stream.getTracks()) {
                t.stop();
              }
              const message = getVirtualCameraMessage(virtualCheck);
              setCameraError(LivenessErrorState.VIRTUAL_CAMERA_DETECTED);
              setCameraErrorMessage(message);
              throw new Error(message);
            }

            // Save preferred camera if enabled
            if (rememberDevice) {
              savePreferredCamera(device);
            }
          }
        }
      }

      video.srcObject = stream;
      streamRef.current = stream;
      await video.play();
      setIsStreaming(true);
      setPermissionStatus("granted");
    } catch (error) {
      setPermissionStatus("denied");
      stopCamera();
      throw error;
    }
  }, [
    facingMode,
    idealWidth,
    idealHeight,
    stopCamera,
    selectedDeviceId,
    validateFrameRateOption,
    minFrameRate,
    blockVirtualCameras,
    availableDevices,
    rememberDevice,
  ]);

  /**
   * Get or create a pooled canvas with the specified dimensions.
   * Reuses the same canvas instance, resizing only when needed.
   */
  const getPooledCanvas = useCallback(
    (
      width: number,
      height: number
    ): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null => {
      const pool = canvasPoolRef.current;

      // Reuse existing canvas if dimensions match
      if (pool && pool.width === width && pool.height === height) {
        return { canvas: pool.canvas, ctx: pool.ctx };
      }

      // Create or resize canvas
      const canvas = pool?.canvas ?? document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      // Get context with willReadFrequently for brightness correction support
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return null;
      }

      canvasPoolRef.current = { canvas, ctx, width, height };
      return { canvas, ctx };
    },
    []
  );

  /**
   * Capture a frame to dataURL with optional brightness correction.
   */
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video) {
      return null;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    if (video.readyState < 2) {
      return null;
    }

    const pooled = getPooledCanvas(video.videoWidth, video.videoHeight);
    if (!pooled) {
      return null;
    }
    const { canvas, ctx } = pooled;

    ctx.drawImage(video, 0, 0);

    if (!skipBrightnessCorrection) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Sample brightness on a subset of pixels
      let totalBrightness = 0;
      const sampleSize = Math.min(1200, data.length / 4);
      const step = Math.max(1, Math.floor(data.length / 4 / sampleSize));
      for (let i = 0; i < sampleSize; i++) {
        const idx = i * step * 4;
        const r = data[idx] ?? 0;
        const g = data[idx + 1] ?? 0;
        const b = data[idx + 2] ?? 0;
        totalBrightness += r * 0.299 + g * 0.587 + b * 0.114;
      }
      const avgBrightness = totalBrightness / sampleSize;

      if (avgBrightness < brightnessTarget - 10) {
        const multiplier = Math.min(
          2.5,
          brightnessTarget / Math.max(avgBrightness, 1)
        );
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, (data[i] ?? 0) * multiplier);
          data[i + 1] = Math.min(255, (data[i + 1] ?? 0) * multiplier);
          data[i + 2] = Math.min(255, (data[i + 2] ?? 0) * multiplier);
        }
        ctx.putImageData(imageData, 0, 0);
      }
    }

    return canvas.toDataURL("image/jpeg", 0.85);
  }, [brightnessTarget, skipBrightnessCorrection, getPooledCanvas]);

  /**
   * Capture a frame optimized for streaming (smaller size, lower quality).
   * Used for real-time server feedback during liveness challenges.
   */
  const captureStreamFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video) {
      return null;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    if (video.readyState < 2) {
      return null;
    }

    // Target 640x480 max for streaming
    const MAX_WIDTH = 640;
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    const pooled = getPooledCanvas(width, height);
    if (!pooled) {
      return null;
    }
    const { canvas, ctx } = pooled;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Lower quality (70%) for faster transmission
    return canvas.toDataURL("image/jpeg", 0.7);
  }, [getPooledCanvas]);

  // Stop camera when component using the hook unmounts.
  useEffect(() => () => stopCamera(), [stopCamera]);

  return {
    videoRef,
    isStreaming,
    permissionStatus,
    startCamera,
    stopCamera,
    captureFrame,
    captureStreamFrame,
    isMobile,
    availableDevices,
    selectedDeviceId,
    selectDevice: setSelectedDeviceId,
    enumerateDevices,
    cameraError,
    cameraErrorMessage,
  };
}
