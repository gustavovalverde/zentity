/**
 * Liveness detection React hooks.
 *
 * Three cohesive hooks consumed together by liveness-provider.tsx:
 *
 *   useLivenessCamera   - camera permissions, device selection, frame capture
 *   useLivenessFeedback - audio earcons, TTS speech, haptic vibration
 *   useLiveness         - Socket.io streaming + challenge state orchestration
 *
 * All feedback (audio/speech/haptic) is generated locally in the browser — no
 * data leaves the device for feedback purposes. Face detection runs server-side
 * via the Socket.io handler in ./socket.ts.
 */
"use client";

import type { ChallengeType } from "@/lib/identity/liveness/challenges";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";

import {
  checkForVirtualCamera,
  filterPhysicalCameras,
  findPreferredDevice,
  getFrameRateMessage,
  getVirtualCameraMessage,
  MIN_FRAMERATE,
  savePreferredCamera,
  validateFrameRate,
} from "@/lib/identity/liveness/camera";
import {
  createLivenessError,
  getAutoRetryCount,
  type LivenessError,
  LivenessErrorState,
  mapLegacyErrorCode,
} from "@/lib/identity/liveness/errors";
import {
  audioEngine,
  EARCONS,
  type EarconType,
  HAPTIC_PATTERNS,
  type HapticType,
  isHapticsSupported,
  type SpeechKey,
  type SupportedLanguage,
  speechEngine,
  vibrate,
} from "@/lib/identity/liveness/feedback";

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

interface UseLivenessCameraOptions {
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

interface UseLivenessCameraResult {
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

// ---------------------------------------------------------------------------
// Feedback hook
// ---------------------------------------------------------------------------

type FeedbackType = EarconType;

interface FeedbackOptions {
  /** Enable/disable earcon audio. Default: true */
  audioEnabled?: boolean;
  /** Enable/disable haptic vibration. Default: true */
  hapticEnabled?: boolean;
  /** Language for TTS. Default: auto-detected */
  language?: SupportedLanguage;
  /** Enable/disable TTS speech. Default: true */
  speechEnabled?: boolean;
}

interface FeedbackController {
  // State getters
  audioEnabled: boolean;

  // Support checks
  audioSupported: boolean;
  cancelSpeech: () => void;
  // Unified feedback trigger with optional stereo pan (-1 = left, 0 = center, 1 = right)
  feedback: (type: FeedbackType, pan?: number) => void;
  hapticEnabled: boolean;
  hapticSupported: boolean;

  // Initialize audio/speech (must be called from user interaction)
  initAudio: () => void;
  initSpeech: () => void;
  isSpeaking: boolean;

  // Individual feedback methods
  playEarcon: (type: EarconType, pan?: number) => void;

  // State controls
  setAudioEnabled: (enabled: boolean) => void;
  setHapticEnabled: (enabled: boolean) => void;
  setSpeechEnabled: (enabled: boolean) => void;
  speak: (key: SpeechKey, priority?: "low" | "high") => Promise<void>;
  speakText: (text: string, priority?: "low" | "high") => Promise<void>;
  speechEnabled: boolean;
  speechSupported: boolean;
  triggerHaptic: (type: HapticType) => void;
}

const FEEDBACK_STORAGE_KEY = "zentity-liveness-feedback-prefs";

interface StoredFeedbackPrefs {
  audioEnabled: boolean;
  hapticEnabled: boolean;
  speechEnabled: boolean;
}

function loadFeedbackPrefs(): StoredFeedbackPrefs | null {
  if (globalThis.window === undefined) {
    return null;
  }
  try {
    const stored = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as StoredFeedbackPrefs;
    }
  } catch {
    // Ignore localStorage errors
  }
  return null;
}

function saveFeedbackPrefs(prefs: StoredFeedbackPrefs): void {
  if (globalThis.window === undefined) {
    return;
  }
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Hook for managing liveness detection feedback.
 *
 * Privacy: all feedback is generated locally in the browser.
 * - Audio: Web Audio API (programmatic synthesis)
 * - Speech: Web Speech API (device's built-in TTS)
 * - Haptics: Vibration API
 */
export function useLivenessFeedback(
  options: FeedbackOptions = {}
): FeedbackController {
  // Load persisted preferences or use defaults (all enabled)
  const storedPrefs = useRef(loadFeedbackPrefs());

  const [audioEnabled, setAudioEnabledState] = useState(
    options.audioEnabled ?? storedPrefs.current?.audioEnabled ?? true
  );
  const [speechEnabled, setSpeechEnabledState] = useState(
    options.speechEnabled ?? storedPrefs.current?.speechEnabled ?? true
  );
  const [hapticEnabled, setHapticEnabledState] = useState(
    options.hapticEnabled ?? storedPrefs.current?.hapticEnabled ?? true
  );
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Support checks
  const audioSupported = audioEngine.isSupported();
  const speechSupported = speechEngine.isSupported();
  const hapticSupported = isHapticsSupported();

  // Set language if provided
  useEffect(() => {
    if (options.language) {
      speechEngine.setLanguage(options.language);
    }
  }, [options.language]);

  // Wire speech engine reference to audio engine for coordination
  useEffect(() => {
    audioEngine.setSpeechEngineRef(speechEngine);
    return () => {
      audioEngine.setSpeechEngineRef(null);
      audioEngine.resetDebounce();
    };
  }, []);

  // Sync engine states with hook state (only when changed)
  useEffect(() => {
    audioEngine.setEnabled(audioEnabled);
  }, [audioEnabled]);

  useEffect(() => {
    speechEngine.setEnabled(speechEnabled);
  }, [speechEnabled]);

  // Persist preferences
  useEffect(() => {
    saveFeedbackPrefs({ audioEnabled, speechEnabled, hapticEnabled });
  }, [audioEnabled, speechEnabled, hapticEnabled]);

  // Initialize audio context (must be from user interaction)
  const initAudio = useCallback(() => {
    audioEngine.init();
  }, []);

  // Initialize speech synthesis (must be from user interaction)
  const initSpeech = useCallback(() => {
    speechEngine.init();
  }, []);

  // Play earcon with optional stereo panning
  const playEarcon = useCallback(
    (type: EarconType, pan = 0) => {
      if (audioEnabled && audioSupported) {
        const config = EARCONS[type];
        audioEngine.playEarcon(config, type, pan);
      }
    },
    [audioEnabled, audioSupported]
  );

  // Speak by key (fire-and-forget: errors are caught internally)
  const speak = useCallback(
    async (key: SpeechKey, priority: "low" | "high" = "low") => {
      if (!(speechEnabled && speechSupported)) {
        return;
      }

      setIsSpeaking(true);
      try {
        await speechEngine.speakKey(key, { priority });
      } catch {
        // Speech synthesis failed (audio-busy, not-allowed, etc.)
        // This is non-critical - visual cues remain available
      } finally {
        setIsSpeaking(false);
      }
    },
    [speechEnabled, speechSupported]
  );

  // Speak custom text (fire-and-forget: errors are caught internally)
  const speakText = useCallback(
    async (text: string, priority: "low" | "high" = "low") => {
      if (!(speechEnabled && speechSupported)) {
        return;
      }

      setIsSpeaking(true);
      try {
        await speechEngine.speak(text, { priority });
      } catch {
        // Speech synthesis failed (audio-busy, not-allowed, etc.)
        // This is non-critical - visual cues remain available
      } finally {
        setIsSpeaking(false);
      }
    },
    [speechEnabled, speechSupported]
  );

  // Trigger haptic
  const triggerHaptic = useCallback(
    (type: HapticType) => {
      if (hapticEnabled && hapticSupported) {
        const pattern = HAPTIC_PATTERNS[type];
        if (pattern) {
          vibrate(pattern);
        }
      }
    },
    [hapticEnabled, hapticSupported]
  );

  // Cancel speech
  const cancelSpeech = useCallback(() => {
    speechEngine.cancel();
    setIsSpeaking(false);
  }, []);

  // Unified feedback trigger (earcon + haptic) with optional stereo pan
  const feedback = useCallback(
    (type: FeedbackType, pan = 0) => {
      playEarcon(type, pan);
      triggerHaptic(type as HapticType);
    },
    [playEarcon, triggerHaptic]
  );

  // State setters with persistence
  const setAudioEnabled = useCallback((enabled: boolean) => {
    setAudioEnabledState(enabled);
  }, []);

  const setSpeechEnabled = useCallback((enabled: boolean) => {
    setSpeechEnabledState(enabled);
    if (!enabled) {
      speechEngine.cancel();
    }
  }, []);

  const setHapticEnabled = useCallback((enabled: boolean) => {
    setHapticEnabledState(enabled);
  }, []);

  return {
    feedback,
    playEarcon,
    speak,
    speakText,
    triggerHaptic,
    cancelSpeech,
    setAudioEnabled,
    setSpeechEnabled,
    setHapticEnabled,
    audioEnabled,
    speechEnabled,
    hapticEnabled,
    isSpeaking,
    audioSupported,
    speechSupported,
    hapticSupported,
    initAudio,
    initSpeech,
  };
}

// ---------------------------------------------------------------------------
// Main liveness hook (Socket.io streaming + challenge orchestration)
// ---------------------------------------------------------------------------

export type LivenessPhase =
  | "connecting"
  | "detecting"
  | "countdown"
  | "baseline"
  | "challenging"
  | "capturing"
  | "verifying"
  | "completed"
  | "failed";

interface ChallengeState {
  hint: string | null;
  index: number;
  progress: number;
  total: number;
  type: ChallengeType;
}

interface FaceState {
  box: { x: number; y: number; width: number; height: number } | null;
  detected: boolean;
}

interface LivenessState {
  challenge: ChallengeState | null;
  countdown: number | null;
  face: FaceState;
  hint?: string;
  id: string;
  phase: LivenessPhase;
}

interface CompletedResult {
  antispoofPassed: boolean;
  confidence: number;
  livenessPassed: boolean;
  selfieImage: string;
  sessionId: string;
  verified: boolean;
}

interface FailedResult {
  canRetry: boolean;
  code: string;
  message: string;
}

interface UseLivenessArgs {
  /** Enable debug logging */
  debugEnabled?: boolean | undefined;
  /** Identity draft ID for dashboard flow - enables server-side result persistence */
  draftId?: string | undefined;
  isStreaming: boolean;
  /** Number of challenges (default: 2) */
  numChallenges?: number | undefined;
  onReset: () => void;
  onSessionError?: (() => void) | undefined;
  onVerified: (args: { selfieImage: string; bestSelfieFrame: string }) => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  /** User ID for dashboard flow - required if draftId is provided */
  userId?: string | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface UseLivenessResult {
  /** Start the liveness session */
  beginCamera: () => Promise<void>;
  /** Cancel and reset to initial state (without restarting) */
  cancelSession: () => void;
  /** Current challenge info */
  challenge: ChallengeState | null;
  /** Countdown value (3, 2, 1) */
  countdown: number | null;
  /** Typed error object with recovery info */
  error: LivenessError | null;
  /** Error message if failed */
  errorMessage: string | null;
  /** Face detection state */
  face: FaceState;
  /** Hint message from server */
  hint: string;
  /** Whether socket is connected */
  isConnected: boolean;
  /** Whether a soft retry is in progress */
  isRetrying: boolean;
  /** Current phase */
  phase: LivenessPhase;
  /** Retry after failure */
  retryChallenge: () => void;
  /** Final selfie image after success */
  selfieImage: string | null;
  /** Session ID */
  sessionId: string | null;
  /** Signal that client finished challenge instruction */
  signalChallengeReady: () => void;
  /** Signal that client finished countdown */
  signalCountdownDone: () => void;
}

// Frame capture interval (ms) - balance between responsiveness and server load
const FRAME_INTERVAL_MS = 100; // 10 FPS

// Frame capture settings for useLiveness socket streaming
const MAX_FRAME_WIDTH = 640;
const JPEG_QUALITY = 0.7;

/**
 * Canvas pool for efficient frame capture.
 * Reuses a single canvas to avoid GC pressure from creating new canvases per frame.
 */
interface LivenessCanvasPool {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  height: number;
  width: number;
}

function getOrCreateLivenessCanvas(
  pool: LivenessCanvasPool | null,
  width: number,
  height: number
): LivenessCanvasPool | null {
  // Reuse if dimensions match
  if (pool && pool.width === width && pool.height === height) {
    return pool;
  }

  // Create new canvas with correct dimensions
  const canvas = pool?.canvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  return { canvas, ctx, width, height };
}

/**
 * Convert video frame to binary JPEG for efficient transmission.
 * Uses pooled canvas to avoid creating new canvas per frame.
 */
function captureFrameAsBlob(
  video: HTMLVideoElement,
  canvasPool: React.RefObject<LivenessCanvasPool | null>
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!video || video.readyState < 2) {
      resolve(null);
      return;
    }

    // Calculate dimensions (scale down for server processing)
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    // Get or create pooled canvas
    const pool = getOrCreateLivenessCanvas(canvasPool.current, width, height);
    if (!pool) {
      resolve(null);
      return;
    }
    canvasPool.current = pool;

    // Draw and encode
    pool.ctx.drawImage(video, 0, 0, width, height);
    pool.canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
  });
}

export function useLiveness(args: UseLivenessArgs): UseLivenessResult {
  const {
    videoRef,
    isStreaming,
    startCamera,
    stopCamera,
    numChallenges = 2,
    debugEnabled = false,
    draftId,
    userId,
    onVerified,
    onReset,
    onSessionError,
  } = args;

  // Refs for callbacks to avoid dependency issues
  const onVerifiedRef = useRef(onVerified);
  const onResetRef = useRef(onReset);
  const onSessionErrorRef = useRef(onSessionError);
  onVerifiedRef.current = onVerified;
  onResetRef.current = onReset;
  onSessionErrorRef.current = onSessionError;

  // Socket and streaming refs
  const socketRef = useRef<Socket | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSendingRef = useRef(false);
  const canvasPoolRef = useRef<LivenessCanvasPool | null>(null);

  // Soft retry tracking
  const softRetryCountRef = useRef(0);

  // State
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<LivenessPhase>("connecting");
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [face, setFace] = useState<FaceState>({
    detected: false,
    box: null,
  });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hint, setHint] = useState("");
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [error, setError] = useState<LivenessError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // Clean up function
  const cleanup = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    isSendingRef.current = false;
    canvasPoolRef.current = null;
  }, []);

  // Connect to socket and start session
  const connectAndStart = useCallback(() => {
    // Clean up any existing connection
    cleanup();

    const socket = io({
      path: "/api/liveness/socket",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 3,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      if (debugEnabled) {
        console.log("[liveness] Connected");
      }
      setIsConnected(true);
      // Start session with optional draft linkage for dashboard flow
      socket.emit("start", {
        challenges: numChallenges,
        draftId,
        userId,
      });
    });

    socket.on("disconnect", (reason) => {
      if (debugEnabled) {
        console.log("[liveness] Disconnected:", reason);
      }
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      if (debugEnabled) {
        console.error("[liveness] Connection error:", err);
      }
      setErrorMessage("Failed to connect to liveness server");
      setPhase("failed");
    });

    // Handle state updates from server
    socket.on("state", (state: LivenessState) => {
      if (debugEnabled) {
        console.log("[liveness] State:", state);
      }
      setSessionId(state.id);
      setPhase(state.phase);
      setChallenge(state.challenge);
      setFace(state.face);
      setCountdown(state.countdown);
      if (state.hint) {
        setHint(state.hint);
      }
    });

    // Handle completion (with acknowledgment) — guard against duplicate events
    let completedHandled = false;
    socket.on("completed", (result: CompletedResult, ack?: () => void) => {
      ack?.();

      if (completedHandled) {
        return;
      }
      completedHandled = true;

      if (debugEnabled) {
        console.log("[liveness] Completed:", result);
      }
      setPhase("completed");
      setSelfieImage(result.selfieImage);

      // Stop frame streaming and camera
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      stopCamera();

      // Notify parent
      onVerifiedRef.current({
        selfieImage: result.selfieImage,
        bestSelfieFrame: result.selfieImage,
      });

      toast.success("Liveness verified!", {
        description: "All challenges completed successfully.",
      });
    });

    // Handle failure with soft retry logic
    socket.on("failed", (result: FailedResult) => {
      if (debugEnabled) {
        console.log("[liveness] Failed:", result);
      }

      // Map legacy error code to typed error state
      const errorState = mapLegacyErrorCode(result.code);
      const livenessError = createLivenessError(errorState);
      const maxAutoRetries = getAutoRetryCount(errorState);

      // Soft retry logic - retry automatically before showing error UI
      if (softRetryCountRef.current < maxAutoRetries) {
        softRetryCountRef.current++;
        setIsRetrying(true);

        if (debugEnabled) {
          console.log(
            `[liveness] Soft retry ${softRetryCountRef.current}/${maxAutoRetries}`
          );
        }

        // Request server to retry the session
        socket.emit("retry");

        // Brief toast to show retry is happening
        toast.info(livenessError.recovery.message, {
          duration: 2000,
        });

        return;
      }

      // Exceeded soft retries - show error UI
      softRetryCountRef.current = 0;
      setIsRetrying(false);
      setPhase("failed");
      setError(livenessError);
      setErrorMessage(livenessError.message);

      // Stop frame streaming and camera
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      stopCamera();

      toast.error("Verification failed", {
        description: livenessError.message,
      });
    });

    // Handle errors
    socket.on("error", (err: { code: string; message: string }) => {
      if (debugEnabled) {
        console.error("[liveness] Error:", err);
      }
      if (err.code === "session_expired") {
        onSessionErrorRef.current?.();
      }
    });
  }, [cleanup, numChallenges, debugEnabled, stopCamera, draftId, userId]);

  // Send frames to server
  const startFrameStreaming = useCallback(() => {
    if (frameIntervalRef.current) {
      return; // Already streaming
    }

    const sendFrame = async () => {
      const socket = socketRef.current;
      const video = videoRef.current;

      if (!(socket?.connected && video && !isSendingRef.current)) {
        return;
      }

      isSendingRef.current = true;
      try {
        const blob = await captureFrameAsBlob(video, canvasPoolRef);
        if (blob) {
          // Send as binary ArrayBuffer for efficiency
          const buffer = await blob.arrayBuffer();
          socket.emit("frame", buffer);
        }
      } catch {
        // Ignore frame capture errors
      } finally {
        isSendingRef.current = false;
      }
    };

    frameIntervalRef.current = setInterval(sendFrame, FRAME_INTERVAL_MS);
  }, [videoRef]);

  // Stop frame streaming
  const stopFrameStreaming = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    isSendingRef.current = false;
  }, []);

  // Start frame streaming when camera is active and session is in progress
  useEffect(() => {
    const activePhases: LivenessPhase[] = [
      "detecting",
      "countdown",
      "baseline",
      "challenging",
      "verifying",
    ];

    if (isStreaming && isConnected && activePhases.includes(phase)) {
      startFrameStreaming();
    } else {
      stopFrameStreaming();
    }

    return () => stopFrameStreaming();
  }, [
    isStreaming,
    isConnected,
    phase,
    startFrameStreaming,
    stopFrameStreaming,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  // Begin camera and connect
  const beginCamera = useCallback(async () => {
    setPhase("connecting");
    setErrorMessage(null);
    setSelfieImage(null);
    setHint("");

    try {
      await startCamera();
      connectAndStart();
    } catch {
      toast.error("Camera access denied", {
        description: "Please allow camera access to continue.",
      });
      setPhase("failed");
      setErrorMessage("Camera access denied");
    }
  }, [startCamera, connectAndStart]);

  const signalCountdownDone = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.connected) {
      if (debugEnabled) {
        console.log("[liveness] Signal: countdown:done");
      }
      socket.emit("countdown:done");
    }
  }, [debugEnabled]);

  const signalChallengeReady = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.connected) {
      if (debugEnabled) {
        console.log("[liveness] Signal: challenge:ready");
      }
      socket.emit("challenge:ready");
    }
  }, [debugEnabled]);

  // Retry after failure
  const retryChallenge = useCallback(() => {
    cleanup();
    stopCamera();

    setPhase("connecting");
    setChallenge(null);
    setFace({ detected: false, box: null });
    setCountdown(null);
    setHint("");
    setSessionId(null);
    setSelfieImage(null);
    setErrorMessage(null);

    onResetRef.current();
    beginCamera();
  }, [cleanup, stopCamera, beginCamera]);

  // Cancel session - reset to initial state WITHOUT restarting
  const cancelSession = useCallback(() => {
    cleanup();
    stopCamera();

    setPhase("connecting");
    setChallenge(null);
    setFace({ detected: false, box: null });
    setCountdown(null);
    setHint("");
    setSessionId(null);
    setSelfieImage(null);
    setErrorMessage(null);
    setError(null);
    setIsRetrying(false);

    onResetRef.current();
  }, [cleanup, stopCamera]);

  return {
    phase,
    challenge,
    face,
    countdown,
    hint,
    sessionId,
    isConnected,
    beginCamera,
    signalCountdownDone,
    signalChallengeReady,
    retryChallenge,
    cancelSession,
    selfieImage,
    errorMessage,
    error,
    isRetrying,
  };
}
