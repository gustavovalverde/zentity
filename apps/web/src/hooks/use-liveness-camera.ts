"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PermissionState = "checking" | "granted" | "denied" | "prompt";

type UseLivenessCameraOptions = {
  facingMode?: "user" | "environment";
  idealWidth?: number;
  idealHeight?: number;
  brightnessTarget?: number; // target average brightness for capture correction
};

type UseLivenessCameraResult = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
  permissionStatus: PermissionState;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureFrame: () => string | null;
};

/**
 * Shared camera hook used by liveness/doc capture steps.
 * Manages permissions, stream lifecycle, and brightness-corrected frame capture.
 */
export function useLivenessCamera(
  options: UseLivenessCameraOptions = {},
): UseLivenessCameraResult {
  const {
    facingMode = "user",
    idealWidth = 640,
    idealHeight = 480,
    brightnessTarget = 110,
  } = options;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionState>("checking");

  // Check permission once on mount and watch for changes.
  useEffect(() => {
    let cancelled = false;
    async function checkPermission() {
      try {
        if (!navigator.permissions) {
          if (!cancelled) setPermissionStatus("prompt");
          return;
        }
        const result = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        if (!cancelled) {
          setPermissionStatus(result.state as PermissionState);
          result.addEventListener("change", () =>
            setPermissionStatus(result.state as PermissionState),
          );
        }
      } catch {
        if (!cancelled) setPermissionStatus("prompt");
      }
    }
    checkPermission();
    return () => {
      cancelled = true;
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: idealWidth },
          height: { ideal: idealHeight },
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        await videoRef.current.play();
        setIsStreaming(true);
        setPermissionStatus("granted");
      }
    } catch (error) {
      setPermissionStatus("denied");
      stopCamera();
      throw error;
    }
  }, [facingMode, idealWidth, idealHeight, stopCamera]);

  /**
   * Capture a frame to dataURL with simple brightness correction.
   */
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video) return null;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    if (video.readyState < 2) return null;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);
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
        brightnessTarget / Math.max(avgBrightness, 1),
      );
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, data[i] * multiplier);
        data[i + 1] = Math.min(255, data[i + 1] * multiplier);
        data[i + 2] = Math.min(255, data[i + 2] * multiplier);
      }
      ctx.putImageData(imageData, 0, 0);
    }

    return canvas.toDataURL("image/jpeg", 0.85);
  }, [brightnessTarget]);

  // Stop camera when component using the hook unmounts.
  useEffect(() => () => stopCamera(), [stopCamera]);

  return {
    videoRef,
    isStreaming,
    permissionStatus,
    startCamera,
    stopCamera,
    captureFrame,
  };
}
