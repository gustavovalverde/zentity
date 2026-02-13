/**
 * Liveness Detection Hook
 *
 * Captures video frames and sends them to the server via Socket.io.
 * All face detection runs server-side for consistent performance.
 */
"use client";

import type { ChallengeType } from "@/lib/identity/liveness/challenges";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";

import {
  createLivenessError,
  getAutoRetryCount,
  type LivenessError,
  mapLegacyErrorCode,
} from "@/lib/identity/liveness/errors";

// State types matching server session.ts
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
  type: ChallengeType;
  index: number;
  total: number;
  progress: number;
  hint: string | null;
}

interface FaceState {
  detected: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
}

interface LivenessState {
  id: string;
  phase: LivenessPhase;
  challenge: ChallengeState | null;
  face: FaceState;
  countdown: number | null;
  hint?: string;
}

interface CompletedResult {
  verified: boolean;
  sessionId: string;
  selfieImage: string;
  confidence: number;
  antispoofPassed: boolean;
  livenessPassed: boolean;
}

interface FailedResult {
  code: string;
  message: string;
  canRetry: boolean;
}

export interface UseLivenessArgs {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  /** Number of challenges (default: 2) */
  numChallenges?: number;
  /** Enable debug logging */
  debugEnabled?: boolean;
  /** Identity draft ID for dashboard flow - enables server-side result persistence */
  draftId?: string;
  /** User ID for dashboard flow - required if draftId is provided */
  userId?: string;
  onVerified: (args: { selfieImage: string; bestSelfieFrame: string }) => void;
  onReset: () => void;
  onSessionError?: () => void;
}

export interface UseLivenessResult {
  /** Current phase */
  phase: LivenessPhase;
  /** Current challenge info */
  challenge: ChallengeState | null;
  /** Face detection state */
  face: FaceState;
  /** Countdown value (3, 2, 1) */
  countdown: number | null;
  /** Hint message from server */
  hint: string;
  /** Session ID */
  sessionId: string | null;
  /** Whether socket is connected */
  isConnected: boolean;
  /** Start the liveness session */
  beginCamera: () => Promise<void>;
  /** Signal that client finished countdown */
  signalCountdownDone: () => void;
  /** Signal that client finished challenge instruction */
  signalChallengeReady: () => void;
  /** Retry after failure */
  retryChallenge: () => void;
  /** Cancel and reset to initial state (without restarting) */
  cancelSession: () => void;
  /** Final selfie image after success */
  selfieImage: string | null;
  /** Error message if failed */
  errorMessage: string | null;
  /** Typed error object with recovery info */
  error: LivenessError | null;
  /** Whether a soft retry is in progress */
  isRetrying: boolean;
}

// Frame capture interval (ms) - balance between responsiveness and server load
const FRAME_INTERVAL_MS = 100; // 10 FPS

// Frame capture settings
const MAX_FRAME_WIDTH = 640;
const JPEG_QUALITY = 0.7;

/**
 * Canvas pool for efficient frame capture.
 * Reuses a single canvas to avoid GC pressure from creating new canvases per frame.
 */
interface CanvasPool {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

function getOrCreateCanvas(
  pool: CanvasPool | null,
  width: number,
  height: number
): CanvasPool | null {
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
  canvasPool: React.MutableRefObject<CanvasPool | null>
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
    const pool = getOrCreateCanvas(canvasPool.current, width, height);
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
  const canvasPoolRef = useRef<CanvasPool | null>(null);

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
