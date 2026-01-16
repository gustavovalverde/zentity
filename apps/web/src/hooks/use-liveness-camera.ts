"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  findPreferredDevice,
  savePreferredCamera,
} from "@/lib/liveness/camera/device-storage";
import {
  getFrameRateMessage,
  MIN_FRAMERATE,
  validateFrameRate,
} from "@/lib/liveness/camera/framerate-validation";
import {
  checkForVirtualCamera,
  filterPhysicalCameras,
  getVirtualCameraMessage,
} from "@/lib/liveness/camera/virtual-detection";
import { LivenessErrorState } from "@/lib/liveness/errors";

type PermissionState = "checking" | "granted" | "denied" | "prompt";

// Regex for detecting mobile user agents - defined at module level for performance
const MOBILE_UA_REGEX =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

/**
 * Detect if device is mobile using multiple signals.
 * Used for UI decisions (fullscreen mode), NOT for quality/performance branching.
 */
function detectIsMobile(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth < 768;
  const mobileUA = MOBILE_UA_REGEX.test(navigator.userAgent);
  return (hasTouch && isSmallScreen) || mobileUA;
}

interface UseLivenessCameraOptions {
  facingMode?: "user" | "environment";
  /** Ideal video width */
  idealWidth?: number;
  /** Ideal video height */
  idealHeight?: number;
  /** Target brightness for correction (0-255) */
  brightnessTarget?: number;
  /** Skip brightness correction */
  skipBrightnessCorrection?: boolean;
  /** Block virtual cameras (OBS, ManyCam, etc.) for security. Default: true */
  blockVirtualCameras?: boolean;
  /** Validate frame rate meets minimum. Default: true */
  validateFrameRateOption?: boolean;
  /** Minimum required frame rate. Default: 15 */
  minFrameRate?: number;
  /** Remember selected camera across sessions. Default: true */
  rememberDevice?: boolean;
}

interface UseLivenessCameraResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
  permissionStatus: PermissionState;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureFrame: () => string | null;
  /** Capture frame optimized for streaming (smaller size, lower quality) */
  captureStreamFrame: () => string | null;
  /** Whether device is mobile (for UI decisions like fullscreen) */
  isMobile: boolean;
  /** Available camera devices (physical cameras only if blockVirtualCameras is true) */
  availableDevices: MediaDeviceInfo[];
  /** Currently selected device ID */
  selectedDeviceId: string | null;
  /** Select a specific camera device */
  selectDevice: (deviceId: string | null) => void;
  /** Enumerate available camera devices */
  enumerateDevices: () => Promise<MediaDeviceInfo[]>;
  /** Camera-related error state, if any */
  cameraError: LivenessErrorState | null;
  /** Human-readable camera error message */
  cameraErrorMessage: string | null;
}

/**
 * Shared camera hook for liveness and document capture.
 * Manages permissions, stream lifecycle, and frame capture.
 *
 * Same settings for mobile and desktop - no platform-specific branching.
 * Frames sent to server are capped at 640px anyway (use-liveness.ts).
 */
export function useLivenessCamera(
  options: UseLivenessCameraOptions = {}
): UseLivenessCameraResult {
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
    checkPermission();
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
        totalBrightness +=
          data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      }
      const avgBrightness = totalBrightness / sampleSize;

      if (avgBrightness < brightnessTarget - 10) {
        const multiplier = Math.min(
          2.5,
          brightnessTarget / Math.max(avgBrightness, 1)
        );
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, data[i] * multiplier);
          data[i + 1] = Math.min(255, data[i + 1] * multiplier);
          data[i + 2] = Math.min(255, data[i + 2] * multiplier);
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
