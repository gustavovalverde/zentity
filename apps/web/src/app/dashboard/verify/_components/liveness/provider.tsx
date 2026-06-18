/**
 * Liveness Provider
 *
 * Server-authoritative context provider that exposes liveness state to children.
 * Uses the capture hook directly - NO parallel client state machine.
 *
 * Architecture:
 * - The server engine is the single source of truth; each frame POST returns the
 *   next state, and the client renders it.
 * - The client owns capture, the local 3-2-1 countdown, and feedback only.
 * - Feedback (audio, speech, haptics) is triggered on phase transitions.
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

import { reportRejection } from "@/lib/async-handler";
import { useCamera } from "@/lib/identity/liveness/camera";
import {
  type LivenessUiPhase,
  useLiveness,
} from "@/lib/identity/liveness/capture";
import { useFeedback } from "@/lib/identity/liveness/feedback";

// ============================================================================
// Types
// ============================================================================

interface ChallengeState {
  hint: string | null;
  index: number;
  progress: number;
  total: number;
  type: ChallengeType;
}

interface FaceBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * State context - changes frequently during detection (~10-12 times/sec).
 * Components rendering face overlays or status UI should subscribe here.
 */
interface LivenessStateContextValue {
  audioEnabled: boolean;
  challenge: ChallengeState | null;
  countdown: number | null;
  error: LivenessError | null;
  faceBox: FaceBox | null;
  faceDetected: boolean;
  hint: string;
  isCompleted: boolean;
  isFailed: boolean;
  phase: LivenessUiPhase;
  selfieImage: string | null;
  speechEnabled: boolean;
}

/**
 * Actions context - stable after mount (wrapped in useCallback).
 * Components with buttons/controls should subscribe here to avoid re-renders.
 */
interface LivenessActionsContextValue {
  cancel: () => void;
  initAudio: () => void;
  retry: () => void;
  start: () => void;
  toggleAudio: () => void;
}

/**
 * Camera context - stable after camera initialization.
 * Components rendering video should subscribe here.
 */
interface LivenessCameraContextValue {
  isStreaming: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
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

interface LivenessProviderProps {
  children: ReactNode;
  /** Enable debug logging */
  debug?: boolean | undefined;
  /** Identity draft ID for dashboard flow - enables server-side result persistence */
  draftId?: string | undefined;
  /** Number of challenges (default: 2) */
  numChallenges?: number | undefined;
  /** Called when session resets */
  onReset?: (() => void) | undefined;
  /** Called on session errors (e.g., expired session) */
  onSessionError?: (() => void) | undefined;
  /** Called when verification succeeds */
  onVerified?:
    | ((result: { selfieImage: string; bestSelfieFrame: string }) => void)
    | undefined;
}

// ============================================================================
// Provider Component
// ============================================================================

export function LivenessProvider({
  children,
  numChallenges = 2,
  debug = process.env.NODE_ENV === "development",
  draftId,
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
  const camera = useCamera({
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
  } = useFeedback();

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
    onVerified: (result) => {
      onVerifiedRef.current?.(result);
    },
    onReset: () => {
      onResetRef.current?.();
    },
    onSessionError,
  });

  // Destructure stable callbacks to avoid depending on the full liveness object
  // (which changes identity on every render due to face detection state)
  const { beginCamera, cancelSession, retryChallenge } = liveness;

  // ============================================================================
  // Feedback effects - trigger on phase transitions
  // ============================================================================
  const prevPhaseRef = useRef<LivenessUiPhase>(liveness.phase);
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
          speak("positionFace").catch(reportRejection);
          break;
        // countdown: handled by dedicated effect with beep sounds
        case "verifying":
          speak("verifying").catch(reportRejection);
          break;
        case "completed":
          feedback("verificationComplete");
          speak("verificationComplete").catch(reportRejection);
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
        speak("faceLost").catch(reportRejection);
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

      const speechKey = {
        smile: "smile",
        turn_left: "turnLeft",
        turn_right: "turnRight",
      }[challenge.type] as "smile" | "turnLeft" | "turnRight";

      speak(speechKey).catch(reportRejection);
    }
  }, [liveness.challenge, speak, debug]);

  // Local 3-2-1 countdown display while the server is in "countdown" phase. The
  // server advances on its own timer (countdownDurationMs matches this 3s), so
  // the client only renders and plays earcons; it sends no "done" signal.
  useEffect(() => {
    if (liveness.phase !== "countdown") {
      setLocalCountdown(null);
      return;
    }

    cancelSpeech();
    setLocalCountdown(3);
    feedback("countdown3");

    const interval = setInterval(() => {
      setLocalCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [liveness.phase, cancelSpeech, feedback]);

  // Countdown earcons as the local counter ticks down.
  useEffect(() => {
    if (localCountdown === 2) {
      feedback("countdown2");
    }
    if (localCountdown === 1) {
      feedback("countdown1");
    }
  }, [localCountdown, feedback]);

  // ============================================================================
  // Actions
  // ============================================================================

  const start = useCallback(() => {
    initAudio(); // Initialize audio on user interaction
    beginCamera().catch(reportRejection);
  }, [beginCamera, initAudio]);

  const cancel = useCallback(() => {
    cancelSession();
  }, [cancelSession]);

  const retry = useCallback(() => {
    retryChallenge();
  }, [retryChallenge]);

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

export { useLivenessContext as useLivenessFlow };
