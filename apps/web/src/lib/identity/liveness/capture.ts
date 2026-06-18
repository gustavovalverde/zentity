/**
 * Liveness capture + transport hook.
 *
 * Streams camera frames to the server-authoritative engine over plain HTTP:
 * POST /session to start, then POST /frame per captured JPEG. Each frame
 * response is the next state (snapshot), or a terminal result/failure. There is
 * no socket, no client-side scoring, and no client-driven advancement signal;
 * the server owns the state machine and the client renders what it returns.
 */
"use client";

import type {
  AdvanceResult,
  ChallengeState,
  FaceState,
  LivenessFailure,
  LivenessPhase,
  LivenessResult,
} from "@/lib/identity/liveness/challenges";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { reportRejection } from "@/lib/async-handler";
import {
  createLivenessError,
  getAutoRetryCount,
  type LivenessError,
} from "@/lib/identity/liveness/errors";

/** Client lifecycle phase: the active wire phases plus pre-session and terminal states. */
export type LivenessUiPhase =
  | "connecting"
  | "completed"
  | "failed"
  | LivenessPhase;

const FRAME_INTERVAL_MS = 100; // ~10 FPS
const MAX_FRAME_WIDTH = 640;
const JPEG_QUALITY = 0.7;
const SESSION_ENDPOINT = "/api/identity/liveness/session";
const FRAME_ENDPOINT = "/api/identity/liveness/frame";

const ACTIVE_PHASES: readonly LivenessUiPhase[] = [
  "detecting",
  "countdown",
  "challenging",
  "verifying",
];

// ---------------------------------------------------------------------------
// Frame capture (pooled canvas to avoid GC pressure at ~10 FPS)
// ---------------------------------------------------------------------------

interface LivenessCanvasPool {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  height: number;
  width: number;
}

function getOrCreateCanvas(
  pool: LivenessCanvasPool | null,
  width: number,
  height: number
): LivenessCanvasPool | null {
  if (pool && pool.width === width && pool.height === height) {
    return pool;
  }
  const canvas = pool?.canvas ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  return { canvas, ctx, width, height };
}

function captureFrameAsBlob(
  video: HTMLVideoElement,
  canvasPool: React.RefObject<LivenessCanvasPool | null>
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!video || video.readyState < 2) {
      resolve(null);
      return;
    }
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    const pool = getOrCreateCanvas(canvasPool.current, width, height);
    if (!pool) {
      resolve(null);
      return;
    }
    canvasPool.current = pool;
    pool.ctx.drawImage(video, 0, 0, width, height);
    pool.canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseLivenessArgs {
  debugEnabled?: boolean | undefined;
  /** Identity draft ID for the dashboard flow; enables server-side result persistence. */
  draftId?: string | undefined;
  isStreaming: boolean;
  numChallenges?: number | undefined;
  onReset: () => void;
  onSessionError?: (() => void) | undefined;
  onVerified: (args: { selfieImage: string; bestSelfieFrame: string }) => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface UseLivenessResult {
  beginCamera: () => Promise<void>;
  cancelSession: () => void;
  challenge: ChallengeState | null;
  countdown: number | null;
  error: LivenessError | null;
  errorMessage: string | null;
  face: FaceState;
  hint: string;
  isRetrying: boolean;
  phase: LivenessUiPhase;
  retryChallenge: () => void;
  selfieImage: string | null;
  sessionId: string | null;
}

interface SessionCreated {
  currentChallenge: ChallengeState | null;
  phase: LivenessPhase;
  sessionId: string;
}

export function useLiveness(args: UseLivenessArgs): UseLivenessResult {
  const {
    videoRef,
    isStreaming,
    startCamera,
    stopCamera,
    numChallenges = 2,
    draftId,
    onVerified,
    onReset,
    onSessionError,
  } = args;

  const onVerifiedRef = useRef(onVerified);
  const onResetRef = useRef(onReset);
  const onSessionErrorRef = useRef(onSessionError);
  onVerifiedRef.current = onVerified;
  onResetRef.current = onReset;
  onSessionErrorRef.current = onSessionError;

  const sessionIdRef = useRef<string | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSendingRef = useRef(false);
  const canvasPoolRef = useRef<LivenessCanvasPool | null>(null);
  const softRetryCountRef = useRef(0);
  const completedHandledRef = useRef(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<LivenessUiPhase>("connecting");
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [face, setFace] = useState<FaceState>({ detected: false, box: null });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [hint, setHint] = useState("");
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [error, setError] = useState<LivenessError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const stopFrameStreaming = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    isSendingRef.current = false;
  }, []);

  const cleanup = useCallback(() => {
    stopFrameStreaming();
    sessionIdRef.current = null;
    canvasPoolRef.current = null;
  }, [stopFrameStreaming]);

  // createSession is referenced by both beginCamera and the soft-retry path; a
  // ref breaks the declaration cycle without re-ordering the callbacks.
  const createSessionRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const createSession = useCallback(async () => {
    completedHandledRef.current = false;
    const res = await fetch(SESSION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeCount: numChallenges, draftId }),
    });
    if (!res.ok) {
      throw new Error("Failed to start liveness session");
    }
    const data = (await res.json()) as SessionCreated;
    sessionIdRef.current = data.sessionId;
    setSessionId(data.sessionId);
    setPhase(data.phase);
    setChallenge(data.currentChallenge);
  }, [numChallenges, draftId]);
  createSessionRef.current = createSession;

  const handleCompleted = useCallback(
    (result: LivenessResult) => {
      if (completedHandledRef.current) {
        return;
      }
      completedHandledRef.current = true;
      setPhase("completed");
      setSelfieImage(result.selfieImage);
      stopFrameStreaming();
      stopCamera();
      onVerifiedRef.current({
        selfieImage: result.selfieImage,
        bestSelfieFrame: result.selfieImage,
      });
      toast.success("Liveness verified!", {
        description: "All challenges completed successfully.",
      });
    },
    [stopCamera, stopFrameStreaming]
  );

  const handleFailure = useCallback(
    (failure: LivenessFailure) => {
      const livenessError = createLivenessError(failure.code);
      const maxAutoRetries = getAutoRetryCount(failure.code);

      // Auto-retry within budget mints a fresh session; the camera stays on.
      if (failure.canRetry && softRetryCountRef.current < maxAutoRetries) {
        softRetryCountRef.current++;
        setIsRetrying(true);
        stopFrameStreaming();
        toast.info(livenessError.recovery.message, { duration: 2000 });
        createSessionRef.current().catch(reportRejection);
        return;
      }

      softRetryCountRef.current = 0;
      setIsRetrying(false);
      setPhase("failed");
      setError(livenessError);
      setErrorMessage(livenessError.message);
      stopFrameStreaming();
      stopCamera();
      toast.error("Verification failed", {
        description: livenessError.message,
      });
    },
    [stopCamera, stopFrameStreaming]
  );

  const handleOutcome = useCallback(
    (outcome: AdvanceResult) => {
      if (outcome.phase === "completed") {
        handleCompleted(outcome);
        return;
      }
      if (outcome.phase === "failed") {
        handleFailure(outcome);
        return;
      }
      // Snapshot: a frame made progress, so any in-flight retry has recovered.
      if (softRetryCountRef.current > 0) {
        setIsRetrying(false);
      }
      setPhase(outcome.phase);
      setChallenge(outcome.challenge);
      setFace(outcome.face);
      setCountdown(outcome.countdown);
      if (outcome.hint) {
        setHint(outcome.hint);
      }
    },
    [handleCompleted, handleFailure]
  );

  const sendFrame = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    const video = videoRef.current;
    if (!(currentSessionId && video) || isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;
    try {
      const blob = await captureFrameAsBlob(video, canvasPoolRef);
      if (!blob) {
        return;
      }
      const buffer = await blob.arrayBuffer();
      const res = await fetch(
        `${FRAME_ENDPOINT}?sessionId=${encodeURIComponent(currentSessionId)}`,
        { method: "POST", body: buffer }
      );
      if (res.status === 404) {
        stopFrameStreaming();
        onSessionErrorRef.current?.();
        return;
      }
      if (!res.ok) {
        return; // transient; the next frame retries
      }
      handleOutcome((await res.json()) as AdvanceResult);
    } catch {
      // Ignore transient capture/network errors; the loop continues.
    } finally {
      isSendingRef.current = false;
    }
  }, [videoRef, handleOutcome, stopFrameStreaming]);

  const startFrameStreaming = useCallback(() => {
    if (frameIntervalRef.current) {
      return;
    }
    frameIntervalRef.current = setInterval(() => {
      sendFrame().catch(reportRejection);
    }, FRAME_INTERVAL_MS);
  }, [sendFrame]);

  // Stream frames only while the camera is live and the flow is in an active phase.
  useEffect(() => {
    if (isStreaming && sessionId && ACTIVE_PHASES.includes(phase)) {
      startFrameStreaming();
    } else {
      stopFrameStreaming();
    }
    return () => stopFrameStreaming();
  }, [isStreaming, sessionId, phase, startFrameStreaming, stopFrameStreaming]);

  useEffect(() => () => cleanup(), [cleanup]);

  const resetState = useCallback(() => {
    setChallenge(null);
    setFace({ detected: false, box: null });
    setCountdown(null);
    setHint("");
    setSelfieImage(null);
    setErrorMessage(null);
    setError(null);
  }, []);

  const beginCamera = useCallback(async () => {
    setPhase("connecting");
    setIsRetrying(false);
    softRetryCountRef.current = 0;
    resetState();
    try {
      await startCamera();
      await createSession();
    } catch {
      toast.error("Camera access denied", {
        description: "Please allow camera access to continue.",
      });
      setPhase("failed");
      setErrorMessage("Camera access denied or the session could not start");
    }
  }, [startCamera, createSession, resetState]);

  const retryChallenge = useCallback(() => {
    cleanup();
    stopCamera();
    setPhase("connecting");
    setSessionId(null);
    resetState();
    onResetRef.current();
    beginCamera().catch(reportRejection);
  }, [cleanup, stopCamera, resetState, beginCamera]);

  const cancelSession = useCallback(() => {
    cleanup();
    stopCamera();
    setPhase("connecting");
    setSessionId(null);
    setIsRetrying(false);
    resetState();
    onResetRef.current();
  }, [cleanup, stopCamera, resetState]);

  return {
    phase,
    challenge,
    face,
    countdown,
    hint,
    sessionId,
    beginCamera,
    retryChallenge,
    cancelSession,
    selfieImage,
    errorMessage,
    error,
    isRetrying,
  };
}
