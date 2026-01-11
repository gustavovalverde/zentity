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
  /** Ideal width - will be reduced on mobile for performance */
  idealWidth?: number;
  /** Ideal height - will be reduced on mobile for performance */
  idealHeight?: number;
  brightnessTarget?: number;
  /** Force mobile optimizations regardless of detection */
  forceMobile?: boolean;
  /** Skip brightness correction for faster frame capture */
  skipBrightnessCorrection?: boolean;
  /** Block virtual cameras (OBS, ManyCam, etc.) for security. Default: true */
  blockVirtualCameras?: boolean;
  /** Validate frame rate meets minimum (15 fps). Default: true */
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
  /** Get a square-padded canvas for improved face detection (centered video in square) */
  getSquareDetectionCanvas: () => HTMLCanvasElement | null;
  /** Whether mobile optimizations are active */
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
 * Shared camera hook used by liveness/doc capture steps.
 * Manages permissions, stream lifecycle, and brightness-corrected frame capture.
 *
 * Mobile optimizations:
 * - Lower resolution (480x360 vs 640x480) reduces processing load
 * - Limited frame rate (15fps vs unlimited) reduces power consumption
 * - Simplified brightness correction for faster captures
 */
export function useLivenessCamera(
  options: UseLivenessCameraOptions = {}
): UseLivenessCameraResult {
  const {
    facingMode = "user",
    idealWidth = 640,
    idealHeight = 480,
    brightnessTarget = 110,
    forceMobile,
    skipBrightnessCorrection = false,
    blockVirtualCameras = true,
    validateFrameRateOption = true,
    minFrameRate = MIN_FRAMERATE,
    rememberDevice = true,
  } = options;

  // Detect mobile once on mount
  const isMobile = useMemo(
    () => forceMobile ?? detectIsMobile(),
    [forceMobile]
  );

  // Apply mobile-optimized constraints
  const effectiveWidth = isMobile ? Math.min(480, idealWidth) : idealWidth;
  const effectiveHeight = isMobile ? Math.min(360, idealHeight) : idealHeight;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const squareCanvasRef = useRef<HTMLCanvasElement | null>(null);
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

      // Build constraints with mobile optimizations and optional device selection
      const constraints: MediaStreamConstraints = {
        video: {
          // Use selected device if available, otherwise use facingMode
          ...(selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : { facingMode }),
          width: { ideal: effectiveWidth },
          height: { ideal: effectiveHeight },
          // Mobile: limit frame rate to reduce power/heat and processing load
          ...(isMobile && { frameRate: { ideal: 15, max: 24 } }),
        },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (constraintError) {
        // Fallback: try with minimal constraints if specific ones fail
        // This helps on devices that don't support frameRate constraint
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
    effectiveWidth,
    effectiveHeight,
    isMobile,
    stopCamera,
    selectedDeviceId,
    validateFrameRateOption,
    minFrameRate,
    blockVirtualCameras,
    availableDevices,
    rememberDevice,
  ]);

  /**
   * Capture a frame to dataURL with optional brightness correction.
   * On mobile, brightness correction can be skipped for performance.
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

    const canvas = captureCanvasRef.current ?? document.createElement("canvas");
    captureCanvasRef.current = canvas;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Skip brightness correction on mobile for performance
    const shouldCorrectBrightness = !(skipBrightnessCorrection || isMobile);

    // Use willReadFrequently only if we need to read pixels for brightness
    const ctx = canvas.getContext("2d", {
      willReadFrequently: shouldCorrectBrightness,
    });
    if (!ctx) {
      return null;
    }

    ctx.drawImage(video, 0, 0);

    // The filter.equalization in Human.js config handles some normalization
    if (shouldCorrectBrightness) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Sample brightness on a subset of pixels to save time.
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

    // Use lower quality on mobile for faster encoding
    const quality = isMobile ? 0.75 : 0.85;
    return canvas.toDataURL("image/jpeg", quality);
  }, [brightnessTarget, skipBrightnessCorrection, isMobile]);

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

    const canvas = streamCanvasRef.current ?? document.createElement("canvas");
    streamCanvasRef.current = canvas;
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Lower quality (70%) for faster transmission
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  /**
   * Get a square-padded canvas with the video frame centered.
   * Square images significantly improve face detection accuracy (research finding).
   * The canvas is padded with black bars to maintain aspect ratio.
   *
   * On mobile: caps size to 480px max to reduce tensor allocation overhead.
   */
  const getSquareDetectionCanvas = useCallback((): HTMLCanvasElement | null => {
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

    const { videoWidth, videoHeight } = video;
    const maxDim = Math.max(videoWidth, videoHeight);

    // On mobile, cap the square size to reduce memory and processing
    // 480px is sufficient for face detection and reduces tensor size by ~75%
    const maxSquareSize = isMobile ? 480 : 1280;
    const size = Math.min(maxDim, maxSquareSize);
    const scale = size / maxDim;

    const canvas = squareCanvasRef.current ?? document.createElement("canvas");
    squareCanvasRef.current = canvas;
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    // Fill with black (padding color)
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);

    // Scale and center the video frame in the square canvas
    const scaledWidth = videoWidth * scale;
    const scaledHeight = videoHeight * scale;
    const offsetX = (size - scaledWidth) / 2;
    const offsetY = (size - scaledHeight) / 2;
    ctx.drawImage(video, offsetX, offsetY, scaledWidth, scaledHeight);

    return canvas;
  }, [isMobile]);

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
    getSquareDetectionCanvas,
    isMobile,
    // New camera management features
    availableDevices,
    selectedDeviceId,
    selectDevice: setSelectedDeviceId,
    enumerateDevices,
    cameraError,
    cameraErrorMessage,
  };
}
