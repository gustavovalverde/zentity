/**
 * Liveness Provider
 *
 * Server-authoritative context provider that exposes liveness state to children.
 * Uses use-liveness.ts hook directly - NO parallel client state machine.
 *
 * Architecture:
 * - Server (socket handler) is the single source of truth
 * - Client displays server state and sends signals
 * - Feedback (audio, speech, haptics) triggered on phase transitions
 */
"use client";

import type { ChallengeType } from "@/lib/liveness/challenges";
import type { LivenessError } from "@/lib/liveness/errors";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type LivenessPhase, useLiveness } from "@/hooks/liveness/use-liveness";
import { useLivenessFeedback } from "@/hooks/liveness/use-liveness-feedback";
import { useLivenessCamera } from "@/hooks/use-liveness-camera";

// ============================================================================
// Types
// ============================================================================

export interface ChallengeState {
  type: ChallengeType;
  index: number;
  total: number;
  progress: number;
  hint: string | null;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LivenessContextValue {
  // State (from server via use-liveness hook)
  phase: LivenessPhase;
  faceDetected: boolean;
  faceBox: FaceBox | null;
  countdown: number | null;
  challenge: ChallengeState | null;
  selfieImage: string | null;
  error: LivenessError | null;
  hint: string;
  isCompleted: boolean;
  isFailed: boolean;
  retryCount: number;

  // Actions
  start: () => void;
  retry: () => void;
  cancel: () => void;

  // Camera
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;

  // Feedback controls
  audioEnabled: boolean;
  speechEnabled: boolean;
  toggleAudio: () => void;
  initAudio: () => void;
}

const LivenessContext = createContext<LivenessContextValue | null>(null);

// ============================================================================
// Hook to consume context
// ============================================================================

export function useLivenessContext(): LivenessContextValue {
  const context = useContext(LivenessContext);
  if (!context) {
    throw new Error("useLivenessContext must be used within LivenessProvider");
  }
  return context;
}

// Selective hooks for optimized re-renders
export function useLivenessPhase(): LivenessPhase {
  return useLivenessContext().phase;
}

export function useLivenessFace(): {
  faceDetected: boolean;
  faceBox: FaceBox | null;
} {
  const { faceDetected, faceBox } = useLivenessContext();
  return { faceDetected, faceBox };
}

export function useLivenessChallenge(): {
  challenge: ChallengeState | null;
  progress: number;
} {
  const { challenge } = useLivenessContext();
  return { challenge, progress: challenge?.progress ?? 0 };
}

// ============================================================================
// Provider Props
// ============================================================================

export interface LivenessProviderProps {
  children: ReactNode;
  /** Number of challenges (default: 2) */
  numChallenges?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Called when verification succeeds */
  onVerified?: (result: {
    selfieImage: string;
    bestSelfieFrame: string;
  }) => void;
  /** Called when session resets */
  onReset?: () => void;
  /** Called on session errors (e.g., expired session) */
  onSessionError?: () => void;
}

// ============================================================================
// Provider Component
// ============================================================================

export function LivenessProvider({
  children,
  numChallenges = 2,
  debug = process.env.NODE_ENV === "development",
  onVerified,
  onReset,
  onSessionError,
}: LivenessProviderProps) {
  // Refs to avoid stale closures
  const onVerifiedRef = useRef(onVerified);
  const onResetRef = useRef(onReset);
  onVerifiedRef.current = onVerified;
  onResetRef.current = onReset;

  // ============================================================================
  // Camera (with security features: virtual camera blocking, frame rate validation)
  // ============================================================================
  const camera = useLivenessCamera({
    facingMode: "user",
    blockVirtualCameras: true,
    validateFrameRateOption: true,
  });

  // Log camera errors
  useEffect(() => {
    if (camera.cameraError && debug) {
      console.log(
        `[liveness] Camera error: ${camera.cameraError}`,
        camera.cameraErrorMessage
      );
    }
  }, [camera.cameraError, camera.cameraErrorMessage, debug]);

  // ============================================================================
  // Feedback system (audio, speech, haptics)
  // ============================================================================
  const {
    feedback,
    speak,
    cancelSpeech,
    audioEnabled,
    speechEnabled,
    setAudioEnabled,
    setSpeechEnabled,
    initAudio,
  } = useLivenessFeedback();

  // ============================================================================
  // Local countdown state (client-side 3-2-1 display)
  // ============================================================================
  const [localCountdown, setLocalCountdown] = useState<number | null>(null);

  // ============================================================================
  // Main liveness hook - server state flows through here
  // ============================================================================
  const liveness = useLiveness({
    videoRef: camera.videoRef,
    isStreaming: camera.isStreaming,
    startCamera: camera.startCamera,
    stopCamera: camera.stopCamera,
    numChallenges,
    debugEnabled: debug,
    onVerified: (result) => {
      onVerifiedRef.current?.(result);
    },
    onReset: () => {
      onResetRef.current?.();
    },
    onSessionError,
  });

  // ============================================================================
  // Feedback effects - trigger on phase transitions
  // ============================================================================
  const prevPhaseRef = useRef<LivenessPhase>(liveness.phase);
  const prevFaceDetectedRef = useRef(false);
  const prevChallengeIndexRef = useRef<number | null>(null);

  // Phase transition feedback
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    const currPhase = liveness.phase;
    prevPhaseRef.current = currPhase;

    if (currPhase !== prevPhase) {
      if (debug) {
        console.log(`[liveness] Phase: ${prevPhase} → ${currPhase}`);
      }

      switch (currPhase) {
        case "detecting":
          speak("positionFace");
          break;
        // countdown: handled by dedicated effect with beep sounds
        case "verifying":
          speak("verifying");
          break;
        case "completed":
          feedback("verificationComplete");
          speak("verificationComplete");
          break;
        case "failed":
          feedback("error");
          break;
        default:
          // Other phases don't trigger speech feedback
          break;
      }
    }
  }, [liveness.phase, feedback, speak, debug]);

  // Face detection feedback
  useEffect(() => {
    const wasDetected = prevFaceDetectedRef.current;
    const isDetected = liveness.face.detected;
    prevFaceDetectedRef.current = isDetected;

    if (liveness.phase === "detecting" && isDetected !== wasDetected) {
      if (isDetected) {
        feedback("faceDetected");
      } else {
        feedback("faceLost");
        speak("faceLost");
      }
    }
  }, [liveness.face.detected, liveness.phase, feedback, speak]);

  // Challenge speech - announce when new challenge starts
  useEffect(() => {
    const challenge = liveness.challenge;
    if (!challenge) {
      prevChallengeIndexRef.current = null;
      return;
    }

    if (challenge.index !== prevChallengeIndexRef.current) {
      prevChallengeIndexRef.current = challenge.index;

      if (debug) {
        console.log(
          `[liveness] Challenge: ${challenge.type} (${challenge.index + 1}/${challenge.total})`
        );
      }

      // Signal to server FIRST so evaluation starts immediately
      // Speech plays in parallel - no need to wait for it
      liveness.signalChallengeReady();

      const speechKey = {
        smile: "smile",
        turn_left: "turnLeft",
        turn_right: "turnRight",
      }[challenge.type] as "smile" | "turnLeft" | "turnRight";

      speak(speechKey);
    }
  }, [liveness.challenge, speak, liveness.signalChallengeReady, debug]);

  // Local countdown timer - runs when server enters "countdown" phase
  useEffect(() => {
    // Only run when phase is countdown
    if (liveness.phase !== "countdown") {
      setLocalCountdown(null);
      return;
    }

    // Cancel any ongoing speech (e.g., "hold still") before countdown starts
    cancelSpeech();

    // Start countdown at 3 and play initial beep
    setLocalCountdown(3);
    feedback("countdown3");

    // Tick down every second
    const interval = setInterval(() => {
      setLocalCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          // Signal server that countdown is done
          liveness.signalCountdownDone();
          return null;
        }
        const next = prev - 1;
        // Play earcon for each tick
        if (next === 2) {
          feedback("countdown2");
        }
        if (next === 1) {
          feedback("countdown1");
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [liveness.phase, liveness.signalCountdownDone, cancelSpeech, feedback]);

  // ============================================================================
  // Actions
  // ============================================================================

  const start = useCallback(() => {
    initAudio(); // Initialize audio on user interaction
    liveness.beginCamera();
  }, [liveness.beginCamera, initAudio]);

  const cancel = useCallback(() => {
    // Clean stop from ANY state - resets phase back to idle
    liveness.cancelSession();
  }, [liveness.cancelSession]);

  const retry = useCallback(() => {
    liveness.retryChallenge();
  }, [liveness.retryChallenge]);

  const toggleAudio = useCallback(() => {
    const newState = !(audioEnabled || speechEnabled);
    setAudioEnabled(newState);
    setSpeechEnabled(newState);
  }, [audioEnabled, speechEnabled, setAudioEnabled, setSpeechEnabled]);

  // ============================================================================
  // Context Value
  // ============================================================================

  const value: LivenessContextValue = useMemo(
    () => ({
      // Server state (passed through)
      phase: liveness.phase,
      faceDetected: liveness.face.detected,
      faceBox: liveness.face.box,
      countdown: localCountdown, // Use local countdown (client-side 3-2-1)
      challenge: liveness.challenge,
      selfieImage: liveness.selfieImage,
      error: liveness.error,
      hint: liveness.hint,
      isCompleted: liveness.phase === "completed",
      isFailed: liveness.phase === "failed",
      retryCount: 0, // Tracked internally by liveness hook

      // Actions
      start,
      retry,
      cancel,

      // Camera
      videoRef: camera.videoRef,
      isStreaming: camera.isStreaming,

      // Feedback
      audioEnabled,
      speechEnabled,
      toggleAudio,
      initAudio,
    }),
    [
      liveness.phase,
      liveness.face,
      localCountdown,
      liveness.challenge,
      liveness.selfieImage,
      liveness.error,
      liveness.hint,
      start,
      retry,
      cancel,
      camera.videoRef,
      camera.isStreaming,
      audioEnabled,
      speechEnabled,
      toggleAudio,
      initAudio,
    ]
  );

  return (
    <LivenessContext.Provider value={value}>
      {children}
    </LivenessContext.Provider>
  );
}

// Export both names for flexibility
export { useLivenessContext as useLiveness };
