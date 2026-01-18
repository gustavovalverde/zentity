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

import type { ChallengeType } from "@/lib/identity/liveness/challenges";
import type { LivenessError } from "@/lib/identity/liveness/errors";

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

interface ChallengeState {
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

/**
 * State context - changes frequently during detection (~10-12 times/sec).
 * Components rendering face overlays or status UI should subscribe here.
 */
interface LivenessStateContextValue {
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
  audioEnabled: boolean;
  speechEnabled: boolean;
}

/**
 * Actions context - stable after mount (wrapped in useCallback).
 * Components with buttons/controls should subscribe here to avoid re-renders.
 */
interface LivenessActionsContextValue {
  start: () => void;
  retry: () => void;
  cancel: () => void;
  toggleAudio: () => void;
  initAudio: () => void;
}

/**
 * Camera context - stable after camera initialization.
 * Components rendering video should subscribe here.
 */
interface LivenessCameraContextValue {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
}

// Three separate contexts for optimized re-renders
const LivenessStateContext = createContext<LivenessStateContextValue | null>(
  null
);
const LivenessActionsContext =
  createContext<LivenessActionsContextValue | null>(null);
const LivenessCameraContext = createContext<LivenessCameraContextValue | null>(
  null
);

// ============================================================================
// Hooks to consume context (optimized for minimal re-renders)
// ============================================================================

/**
 * State context - use when you need phase, face, challenge, error, etc.
 * This context updates frequently during detection.
 */
function useLivenessState(): LivenessStateContextValue {
  const context = useContext(LivenessStateContext);
  if (!context) {
    throw new Error("useLivenessState must be used within LivenessProvider");
  }
  return context;
}

/**
 * Actions context - use for buttons and controls.
 * This context is stable after mount (never causes re-renders).
 */
function useLivenessActions(): LivenessActionsContextValue {
  const context = useContext(LivenessActionsContext);
  if (!context) {
    throw new Error("useLivenessActions must be used within LivenessProvider");
  }
  return context;
}

/**
 * Camera context - use for video rendering.
 * This context is stable after camera starts streaming.
 */
function useLivenessCameraContext(): LivenessCameraContextValue {
  const context = useContext(LivenessCameraContext);
  if (!context) {
    throw new Error(
      "useLivenessCameraContext must be used within LivenessProvider"
    );
  }
  return context;
}

/**
 * Combined context - use when you need everything.
 * Consider using the specific hooks above for better performance.
 */
function useLivenessContext(): LivenessStateContextValue &
  LivenessActionsContextValue &
  LivenessCameraContextValue {
  const state = useLivenessState();
  const actions = useLivenessActions();
  const camera = useLivenessCameraContext();
  return { ...state, ...actions, ...camera };
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
  /** Identity draft ID for dashboard flow - enables server-side result persistence */
  draftId?: string;
  /** User ID for dashboard flow - required if draftId is provided */
  userId?: string;
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
  draftId,
  userId,
  onVerified,
  onReset,
  onSessionError,
}: Readonly<LivenessProviderProps>) {
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
    draftId,
    userId,
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
  // Split Context Values (for optimized re-renders)
  // ============================================================================

  // Extract primitive values from face object to avoid object reference changes
  // triggering re-renders on every detection frame (~10-12x/sec)
  const faceDetected = liveness.face.detected;
  const faceBoxSource = liveness.face.box;
  const faceBoxX = faceBoxSource?.x ?? null;
  const faceBoxY = faceBoxSource?.y ?? null;
  const faceBoxWidth = faceBoxSource?.width ?? null;
  const faceBoxHeight = faceBoxSource?.height ?? null;

  // State context - changes frequently during detection.
  // Primitive face values control memoization to avoid recomputing on every
  // object reference change from face detection (~10-12fps).
  const stateValue: LivenessStateContextValue = useMemo(() => {
    const faceBox: FaceBox | null =
      faceBoxX !== null &&
      faceBoxY !== null &&
      faceBoxWidth !== null &&
      faceBoxHeight !== null
        ? {
            x: faceBoxX,
            y: faceBoxY,
            width: faceBoxWidth,
            height: faceBoxHeight,
          }
        : null;

    return {
      phase: liveness.phase,
      faceDetected,
      faceBox,
      countdown: localCountdown,
      challenge: liveness.challenge,
      selfieImage: liveness.selfieImage,
      error: liveness.error,
      hint: liveness.hint,
      isCompleted: liveness.phase === "completed",
      isFailed: liveness.phase === "failed",
      retryCount: 0,
      audioEnabled,
      speechEnabled,
    };
  }, [
    liveness.phase,
    faceDetected,
    faceBoxX,
    faceBoxY,
    faceBoxWidth,
    faceBoxHeight,
    localCountdown,
    liveness.challenge,
    liveness.selfieImage,
    liveness.error,
    liveness.hint,
    audioEnabled,
    speechEnabled,
  ]);

  // Actions context - stable after mount (empty deps = never changes)
  const actionsValue: LivenessActionsContextValue = useMemo(
    () => ({
      start,
      retry,
      cancel,
      toggleAudio,
      initAudio,
    }),
    [start, retry, cancel, toggleAudio, initAudio]
  );

  // Camera context - stable after camera starts
  const cameraValue: LivenessCameraContextValue = useMemo(
    () => ({
      videoRef: camera.videoRef,
      isStreaming: camera.isStreaming,
    }),
    [camera.videoRef, camera.isStreaming]
  );

  return (
    <LivenessStateContext.Provider value={stateValue}>
      <LivenessActionsContext.Provider value={actionsValue}>
        <LivenessCameraContext.Provider value={cameraValue}>
          {children}
        </LivenessCameraContext.Provider>
      </LivenessActionsContext.Provider>
    </LivenessStateContext.Provider>
  );
}

// Export both names for flexibility
export { useLivenessContext as useLiveness };
