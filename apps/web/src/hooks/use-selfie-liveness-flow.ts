"use client";

import type { Human } from "@vladmandic/human";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getFacingDirection,
  getGestureNames,
  getHappyScore,
  getPrimaryFace,
  getYawDegrees,
} from "@/lib/human-metrics";
import {
  CHALLENGE_INSTRUCTIONS,
  type ChallengeInfo,
  type ChallengeType,
} from "@/lib/liveness-challenges";
import {
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "@/lib/liveness-policy";

export type ChallengeState =
  | "idle"
  | "loading_session"
  | "detecting"
  | "countdown"
  | "preparing_challenge"
  | "waiting_challenge"
  | "capturing"
  | "validating"
  | "challenge_passed"
  | "all_passed"
  | "failed"
  | "timeout";

type FacingDirection = "left" | "right" | "center";

export type LivenessDebugFrame = {
  ts: number;
  state: ChallengeState;
  faceDetected: boolean;
  happy: number;
  baselineHappy: number;
  deltaHappy: number;
  yawDeg: number;
  dir: FacingDirection;
  headTurnCentered: boolean;
  consecutiveDetections: number;
  consecutiveChallengeDetections: number;
  videoWidth: number;
  videoHeight: number;
  gesture: string[];
};

type LivenessSession = {
  sessionId: string;
  challenges: ChallengeType[];
};

type UseSelfieLivenessFlowArgs = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStreaming: boolean;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureFrame: () => string | null;
  human: Human | null;
  humanReady: boolean;
  livenessDebugEnabled: boolean;
  initialSelfieImage?: string | null;
  onVerified: (args: {
    selfieImage: string;
    bestSelfieFrame: string;
    blinkCount: number | null;
  }) => void;
  onReset: () => void;
};

// Configuration constants
const DETECTION_INTERVAL = 300; // ms between detection checks
export const STABILITY_FRAMES = 3; // consecutive positive detections needed
const CHALLENGE_TIMEOUT = 10000; // 10 seconds per challenge
const FACE_TIMEOUT = 30000; // 30 seconds to show face
const HEAD_CENTER_THRESHOLD = 5; // degrees deadzone to ensure forward start
const NUM_CHALLENGES = 2; // number of random challenges
const CHALLENGE_PASSED_DELAY = 1000; // ms to show "passed" before next challenge
const CHALLENGE_PREP_DELAY = 2000; // ms to prepare before next challenge starts

export function useSelfieLivenessFlow(args: UseSelfieLivenessFlowArgs) {
  const {
    videoRef,
    isStreaming,
    startCamera,
    stopCamera,
    captureFrame,
    human,
    humanReady,
    livenessDebugEnabled,
    initialSelfieImage,
    onVerified,
    onReset,
  } = args;

  const [challengeState, setChallengeState] = useState<ChallengeState>("idle");
  const [baselineImage, setBaselineImage] = useState<string | null>(null);
  const [challengeImage, setChallengeImage] = useState<string | null>(
    initialSelfieImage || null,
  );

  const [session, setSession] = useState<LivenessSession | null>(null);
  const [currentChallenge, setCurrentChallenge] =
    useState<ChallengeInfo | null>(null);
  const [completedChallenges, setCompletedChallenges] = useState<
    Array<{ type: ChallengeType; image: string }>
  >([]);
  const [baselineHappyScore, setBaselineHappyScore] = useState(0);

  const [detectionProgress, setDetectionProgress] = useState(0);
  const [challengeProgress, setChallengeProgress] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [timeoutMessage, setTimeoutMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const consecutiveDetectionsRef = useRef(0);
  const consecutiveChallengeDetectionsRef = useRef(0);
  const isCheckingRef = useRef(false);
  const headTurnCenteredRef = useRef(false);
  const headTurnStartYawRef = useRef(0);
  const lastHappyRef = useRef(0);

  const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugLastUpdateRef = useRef(0);
  const [debugFrame, setDebugFrame] = useState<LivenessDebugFrame | null>(null);

  const buildChallengeInfo = useCallback(
    (
      challengeType: ChallengeType,
      index: number,
      total: number,
    ): ChallengeInfo => {
      return {
        challengeType,
        index,
        total,
        ...CHALLENGE_INSTRUCTIONS[challengeType],
      };
    },
    [],
  );

  const syncDebugCanvasSize = useCallback(() => {
    if (!livenessDebugEnabled) return;
    const video = videoRef.current;
    const canvas = debugCanvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    if (!width || !height) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }, [livenessDebugEnabled, videoRef]);

  const drawDebugOverlay = useCallback(
    (result: unknown) => {
      if (!livenessDebugEnabled) return;
      if (!human || !videoRef.current) return;
      const canvas = debugCanvasRef.current;
      if (!canvas) return;

      syncDebugCanvasSize();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      try {
        const res = result as { face?: unknown[] } | null;
        human.draw?.face?.(
          canvas,
          // biome-ignore lint/suspicious/noExplicitAny: Human.js draw API requires their specific FaceResult type
          (res?.face ?? []) as any,
          {
            drawBoxes: true,
            drawLabels: true,
            drawPolygons: true,
            drawPoints: false,
            drawGaze: false,
            drawAttention: false,
          },
        );
      } catch {
        // ignore draw errors in debug mode
      }
    },
    [livenessDebugEnabled, human, syncDebugCanvasSize, videoRef],
  );

  const updateDebug = useCallback(
    (result: unknown, face: ReturnType<typeof getPrimaryFace>) => {
      if (!livenessDebugEnabled) return;

      const now = performance.now();
      if (now - debugLastUpdateRef.current < 250) return;
      debugLastUpdateRef.current = now;

      const video = videoRef.current;
      const gestureNames = getGestureNames(result);
      const happy = getHappyScore(face);
      setDebugFrame({
        ts: Date.now(),
        state: challengeState,
        faceDetected: Boolean(face),
        happy,
        baselineHappy: baselineHappyScore,
        deltaHappy: happy - baselineHappyScore,
        yawDeg: face ? getYawDegrees(face) : 0,
        dir: face
          ? getFacingDirection(result, face, HEAD_CENTER_THRESHOLD)
          : "center",
        headTurnCentered: headTurnCenteredRef.current,
        consecutiveDetections: consecutiveDetectionsRef.current,
        consecutiveChallengeDetections:
          consecutiveChallengeDetectionsRef.current,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        gesture: gestureNames,
      });
    },
    [livenessDebugEnabled, videoRef, challengeState, baselineHappyScore],
  );

  useEffect(() => {
    if (!livenessDebugEnabled) return;
    const video = videoRef.current;
    if (!video) return;
    const handle = () => syncDebugCanvasSize();
    video.addEventListener("loadedmetadata", handle);
    handle();
    return () => video.removeEventListener("loadedmetadata", handle);
  }, [livenessDebugEnabled, syncDebugCanvasSize, videoRef]);

  useEffect(() => {
    if (!livenessDebugEnabled) return;
    const canvas = debugCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!isStreaming) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [livenessDebugEnabled, isStreaming]);

  const beginCamera = useCallback(async () => {
    setChallengeState("loading_session");
    try {
      const res = await fetch("/api/liveness/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numChallenges: NUM_CHALLENGES }),
      });
      if (!res.ok) throw new Error(`Session error: ${res.status}`);
      const newSession = (await res.json()) as {
        sessionId: string;
        challenges: ChallengeType[];
        currentChallenge: ChallengeInfo | null;
      };
      setSession({
        sessionId: newSession.sessionId,
        challenges: newSession.challenges,
      });
      setCurrentChallenge(newSession.currentChallenge);
    } catch (err) {
      toast.error("Failed to create challenge session", {
        description: err instanceof Error ? err.message : "Please try again",
      });
      setChallengeState("idle");
      return;
    }

    try {
      await startCamera();
      setChallengeState("detecting");
      setStatusMessage("Position your face in the frame");
    } catch {
      toast.error("Camera access denied", {
        description:
          "Unable to access camera. Please check permissions and try again.",
      });
      setChallengeState("idle");
    }
  }, [startCamera]);

  const checkForFace = useCallback(async () => {
    if (!human || !humanReady || !videoRef.current) return;
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      const raw = await human.detect(videoRef.current);
      const result = human.next(raw);
      const face = getPrimaryFace(result);
      drawDebugOverlay(result);
      updateDebug(result, face ?? null);

      if (face) {
        const dir = getFacingDirection(result, face, HEAD_CENTER_THRESHOLD);
        lastHappyRef.current = getHappyScore(face);

        if (dir === "center") {
          consecutiveDetectionsRef.current++;
          setDetectionProgress(
            (consecutiveDetectionsRef.current / STABILITY_FRAMES) * 100,
          );
          if (consecutiveDetectionsRef.current >= STABILITY_FRAMES) {
            setChallengeState("countdown");
            consecutiveDetectionsRef.current = 0;
          }
        } else {
          consecutiveDetectionsRef.current = 0;
          setDetectionProgress(0);
          setStatusMessage("Center your face in the frame");
        }
      } else {
        consecutiveDetectionsRef.current = 0;
        setDetectionProgress(0);
        setStatusMessage("Position your face in the frame");
      }
    } catch {
      // ignore per-frame errors
    } finally {
      isCheckingRef.current = false;
    }
  }, [human, humanReady, videoRef, drawDebugOverlay, updateDebug]);

  const handleCapturedChallenge = useCallback(
    async (challengeType: ChallengeType, image: string) => {
      if (!session || !baselineImage) return;

      const newCompleted = [
        ...completedChallenges,
        { type: challengeType, image },
      ];
      setCompletedChallenges(newCompleted);
      setChallengeImage(image);

      const nextIndex = (currentChallenge?.index ?? 0) + 1;
      if (nextIndex < session.challenges.length) {
        setChallengeState("challenge_passed");
        setTimeout(() => {
          const nextType = session.challenges[nextIndex];
          setCurrentChallenge(
            buildChallengeInfo(nextType, nextIndex, session.challenges.length),
          );
          setChallengeProgress(0);
          consecutiveChallengeDetectionsRef.current = 0;
          headTurnCenteredRef.current = false;
          headTurnStartYawRef.current = 0;
          setChallengeState("preparing_challenge");
          setTimeout(() => {
            setChallengeState("waiting_challenge");
          }, CHALLENGE_PREP_DELAY);
        }, CHALLENGE_PASSED_DELAY);
        return;
      }

      setChallengeState("validating");
      try {
        const res = await fetch("/api/liveness/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            baselineImage,
            challenges: newCompleted.map((c) => ({
              challengeType: c.type,
              image: c.image,
            })),
          }),
        });
        const data = (await res.json()) as {
          verified?: boolean;
          error?: string;
        };
        if (!res.ok || !data.verified) {
          throw new Error(data.error || "Liveness verification failed");
        }

        setChallengeState("all_passed");
        stopCamera();
        onVerified({
          selfieImage: baselineImage,
          bestSelfieFrame: baselineImage,
          blinkCount: null,
        });
      } catch (err) {
        setChallengeState("failed");
        toast.error("Verification failed", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        stopCamera();
      }
    },
    [
      session,
      baselineImage,
      completedChallenges,
      currentChallenge,
      buildChallengeInfo,
      stopCamera,
      onVerified,
    ],
  );

  const checkCurrentChallenge = useCallback(async () => {
    if (!human || !humanReady || !videoRef.current || !currentChallenge) return;
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      const frameDataUrl = captureFrame();
      if (!frameDataUrl) return;

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = frameDataUrl;
      });

      const raw = await human.detect(img);
      const result = human.next(raw);
      const face = getPrimaryFace(result);
      drawDebugOverlay(result);
      updateDebug(result, face ?? null);
      if (!face) {
        setChallengeState("detecting");
        setStatusMessage("Face lost - position your face in the frame");
        consecutiveChallengeDetectionsRef.current = 0;
        headTurnCenteredRef.current = false;
        headTurnStartYawRef.current = 0;
        return;
      }

      const type = currentChallenge.challengeType;
      const happy = getHappyScore(face);
      lastHappyRef.current = happy;
      const dir = getFacingDirection(result, face, HEAD_CENTER_THRESHOLD);
      const yaw = getYawDegrees(face);

      if (type === "smile") {
        const happyPct = Math.round(happy * 100);
        setChallengeProgress(happyPct);
        const delta = happy - baselineHappyScore;
        const smilePassed =
          (happy >= SMILE_SCORE_THRESHOLD && delta >= SMILE_DELTA_THRESHOLD) ||
          happy >= SMILE_HIGH_THRESHOLD;
        if (smilePassed) {
          consecutiveChallengeDetectionsRef.current++;
          if (consecutiveChallengeDetectionsRef.current >= STABILITY_FRAMES) {
            consecutiveChallengeDetectionsRef.current = 0;
            await handleCapturedChallenge("smile", frameDataUrl);
          }
        } else {
          consecutiveChallengeDetectionsRef.current = 0;
        }
      } else if (type === "turn_left" || type === "turn_right") {
        const yawProgress = Math.min(
          (Math.abs(yaw) / TURN_YAW_ABSOLUTE_THRESHOLD_DEG) * 100,
          100,
        );
        setChallengeProgress(yawProgress);

        if (!headTurnCenteredRef.current) {
          if (dir === "center") {
            headTurnCenteredRef.current = true;
            headTurnStartYawRef.current = yaw;
            setStatusMessage("");
          } else {
            setStatusMessage("Center your head to start the turn");
            return;
          }
        }

        const wantsLeft = type === "turn_left";
        const yawDelta = Math.abs(yaw - headTurnStartYawRef.current);
        const absolutePass = wantsLeft
          ? yaw < -TURN_YAW_ABSOLUTE_THRESHOLD_DEG
          : yaw > TURN_YAW_ABSOLUTE_THRESHOLD_DEG;
        const deltaPass = yawDelta >= TURN_YAW_SIGNIFICANT_DELTA_DEG;
        const correctDirection = wantsLeft
          ? yaw < headTurnStartYawRef.current
          : yaw > headTurnStartYawRef.current;
        const passed = correctDirection && (absolutePass || deltaPass);
        if (passed) {
          consecutiveChallengeDetectionsRef.current = 0;
          await handleCapturedChallenge(type, frameDataUrl);
        }
      }
    } catch {
      // ignore per-frame errors
    } finally {
      isCheckingRef.current = false;
    }
  }, [
    human,
    humanReady,
    videoRef,
    currentChallenge,
    drawDebugOverlay,
    updateDebug,
    baselineHappyScore,
    captureFrame,
    handleCapturedChallenge,
  ]);

  // Countdown effect for baseline capture
  useEffect(() => {
    if (challengeState !== "countdown") return;

    let count = 3;
    setCountdown(count);

    const interval = setInterval(() => {
      count--;
      setCountdown(count);

      if (count === 0) {
        clearInterval(interval);
        const baseline = captureFrame();
        if (baseline) {
          setBaselineImage(baseline);
          setBaselineHappyScore(lastHappyRef.current);
          setChallengeState("waiting_challenge");
          setChallengeProgress(0);
          setStatusMessage("");
          consecutiveChallengeDetectionsRef.current = 0;
        } else {
          setChallengeState("detecting");
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [challengeState, captureFrame]);

  // Main detection loop
  useEffect(() => {
    if (!isStreaming) return;
    if (
      challengeState !== "detecting" &&
      challengeState !== "waiting_challenge"
    ) {
      return;
    }

    let lastCheck = 0;
    let animationId: number;

    const detectLoop = (timestamp: number) => {
      if (timestamp - lastCheck < DETECTION_INTERVAL) {
        animationId = requestAnimationFrame(detectLoop);
        return;
      }
      lastCheck = timestamp;

      if (challengeState === "detecting") {
        void checkForFace();
      } else if (challengeState === "waiting_challenge") {
        void checkCurrentChallenge();
      }

      animationId = requestAnimationFrame(detectLoop);
    };

    animationId = requestAnimationFrame(detectLoop);
    return () => cancelAnimationFrame(animationId);
  }, [isStreaming, challengeState, checkForFace, checkCurrentChallenge]);

  // Face detection timeout
  useEffect(() => {
    if (challengeState !== "detecting") return;

    const timeout = setTimeout(() => {
      setChallengeState("timeout");
      setTimeoutMessage("Could not detect your face. Please try again.");
      stopCamera();
    }, FACE_TIMEOUT);

    return () => clearTimeout(timeout);
  }, [challengeState, stopCamera]);

  // Challenge detection timeout
  useEffect(() => {
    if (challengeState !== "waiting_challenge") return;

    const timeout = setTimeout(() => {
      setChallengeState("timeout");
      const challengeName = currentChallenge?.title || "Challenge";
      setTimeoutMessage(
        `${challengeName} not detected in time. Please try again.`,
      );
      stopCamera();
    }, CHALLENGE_TIMEOUT);

    return () => clearTimeout(timeout);
  }, [challengeState, currentChallenge, stopCamera]);

  // Toast notifications for status changes
  useEffect(() => {
    if (challengeState === "all_passed") {
      toast.success("Liveness verified!", {
        description: `All ${completedChallenges.length} challenges completed successfully!`,
      });
    }
  }, [challengeState, completedChallenges.length]);

  useEffect(() => {
    if (challengeState === "challenge_passed" && currentChallenge) {
      toast.success(`${currentChallenge.title} passed!`, {
        description: "Moving to next challenge...",
        duration: CHALLENGE_PASSED_DELAY,
      });
    }
  }, [challengeState, currentChallenge]);

  useEffect(() => {
    if (challengeState === "timeout") {
      toast.error("Timeout", {
        description: timeoutMessage || "Please try again.",
      });
    }
  }, [challengeState, timeoutMessage]);

  const retryChallenge = useCallback(() => {
    setBaselineImage(null);
    setChallengeImage(null);
    setChallengeState("idle");
    setDetectionProgress(0);
    setChallengeProgress(0);
    setTimeoutMessage("");
    setStatusMessage("");
    setBaselineHappyScore(0);
    setSession(null);
    setCurrentChallenge(null);
    setCompletedChallenges([]);
    consecutiveDetectionsRef.current = 0;
    consecutiveChallengeDetectionsRef.current = 0;
    headTurnCenteredRef.current = false;
    headTurnStartYawRef.current = 0;
    onReset();
    void beginCamera();
  }, [beginCamera, onReset]);

  return {
    challengeState,
    baselineImage,
    challengeImage,
    session,
    currentChallenge,
    completedChallenges,
    detectionProgress,
    challengeProgress,
    countdown,
    timeoutMessage,
    statusMessage,
    debugCanvasRef,
    debugFrame,
    livenessDebugEnabled,
    beginCamera,
    retryChallenge,
  };
}
