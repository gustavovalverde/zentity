"use client";

/* eslint @next/next/no-img-element: off */

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Smile,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useHumanLiveness } from "@/hooks/use-human-liveness";
import { useLivenessCamera } from "@/hooks/use-liveness-camera";
import { trackCameraPermission, trackLiveness } from "@/lib/analytics";
import {
  CHALLENGE_INSTRUCTIONS,
  type ChallengeInfo,
  type ChallengeType,
} from "@/lib/liveness-challenges";
import type { EmotionItem, EmotionScoresObject } from "@/types/human";

// Local types compatible with actual Human.js library output
// Human.js returns emotion as an array of { score, emotion } objects
// Uses permissive types with null to handle Human.js variations
interface LocalFaceResult {
  emotion?: EmotionItem[] | EmotionScoresObject | null;
  rotation?: {
    angle?: {
      yaw?: number;
      pitch?: number;
      roll?: number;
    } | null;
  } | null;
}

interface LocalDetectionResult {
  face?: LocalFaceResult[] | null;
  gesture?: Array<{ gesture?: string; name?: string }> | null;
}

import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

/**
 * Automatic challenge flow states:
 * - idle: Camera not started
 * - loading_session: Creating challenge session from backend
 * - detecting: Auto-detecting face position
 * - countdown: Face found, counting down for baseline capture
 * - preparing_challenge: Get ready for next challenge (2s delay)
 * - waiting_challenge: Baseline captured, waiting for current challenge
 * - capturing: Challenge detected, capturing image
 * - validating: Sending to server for validation
 * - challenge_passed: Current challenge passed, moving to next
 * - all_passed: All challenges passed
 * - failed: Challenge failed
 * - timeout: Took too long
 */
type ChallengeState =
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

// Configuration constants
const DETECTION_INTERVAL = 300; // ms between detection checks
const STABILITY_FRAMES = 3; // consecutive positive detections needed
const CHALLENGE_TIMEOUT = 10000; // 10 seconds per challenge
const FACE_TIMEOUT = 30000; // 30 seconds to show face
const SMILE_SCORE_THRESHOLD = 0.6; // Human happy score (0-1)
const SMILE_DELTA_THRESHOLD = 0.1; // required increase vs baseline (stricter)
const SMILE_HIGH_THRESHOLD = 0.85; // pass if happy score alone is very high
const HEAD_TURN_YAW_THRESHOLD = 18; // degrees absolute threshold
const HEAD_TURN_DELTA_THRESHOLD = 20; // degrees movement from baseline (alternative)
const HEAD_CENTER_THRESHOLD = 5; // degrees deadzone to ensure forward start
const NUM_CHALLENGES = 2; // number of random challenges
const CHALLENGE_PASSED_DELAY = 1000; // ms to show "passed" before next challenge
const CHALLENGE_PREP_DELAY = 2000; // ms to prepare before next challenge starts

type FacingDirection = "left" | "right" | "center";

type LivenessDebugFrame = {
  ts: number;
  state: ChallengeState;
  faceDetected: boolean;
  happy: number;
  baselineHappy: number;
  deltaHappy: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  dir: FacingDirection;
  headTurnCentered: boolean;
  consecutiveDetections: number;
  consecutiveChallengeDetections: number;
  videoWidth: number;
  videoHeight: number;
  gesture: string[];
};

function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function StepSelfie() {
  const { state, updateData, nextStep } = useWizard();
  const {
    videoRef,
    isStreaming,
    permissionStatus,
    startCamera,
    stopCamera,
    captureFrame,
  } = useLivenessCamera({
    facingMode: "user",
    idealWidth: 640,
    idealHeight: 480,
  });

  // Challenge state
  const [challengeState, setChallengeState] = useState<ChallengeState>("idle");
  const [baselineImage, setBaselineImage] = useState<string | null>(null);
  const [challengeImage, setChallengeImage] = useState<string | null>(
    state.data.selfieImage || null,
  );

  // Multi-challenge session state
  const [session, setSession] = useState<{
    sessionId: string;
    challenges: ChallengeType[];
  } | null>(null);
  const [currentChallenge, setCurrentChallenge] =
    useState<ChallengeInfo | null>(null);
  const [completedChallenges, setCompletedChallenges] = useState<
    Array<{ type: ChallengeType; image: string }>
  >([]);
  const [baselineHappyScore, setBaselineHappyScore] = useState(0);

  // Progress indicators
  const [detectionProgress, setDetectionProgress] = useState(0);
  const [challengeProgress, setChallengeProgress] = useState(0); // Generic progress for any challenge
  const [countdown, setCountdown] = useState(3);
  const [timeoutMessage, setTimeoutMessage] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Refs for detection loop
  const consecutiveDetectionsRef = useRef(0);
  const consecutiveChallengeDetectionsRef = useRef(0); // For any challenge type
  const isCheckingRef = useRef(false);
  const headTurnCenteredRef = useRef(false);
  const headTurnStartYawRef = useRef(0); // Track yaw when turn starts

  const livenessDebugEnabled = process.env.NEXT_PUBLIC_LIVENESS_DEBUG === "1";
  const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugLastUpdateRef = useRef(0);
  const [debugFrame, setDebugFrame] = useState<LivenessDebugFrame | null>(null);

  const {
    human,
    ready: humanReady,
    error: humanError,
  } = useHumanLiveness(isStreaming);

  // Track permission changes for analytics and UX hints
  useEffect(() => {
    trackCameraPermission(permissionStatus);
  }, [permissionStatus]);

  // Reset head-turn gating when switching challenges
  useEffect(() => {
    if (
      currentChallenge?.challengeType === "turn_left" ||
      currentChallenge?.challengeType === "turn_right"
    ) {
      headTurnCenteredRef.current = false;
      headTurnStartYawRef.current = 0;
    }
  }, [currentChallenge?.challengeType]);

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
      const errorMsg =
        "Unable to access camera. Please check permissions and try again.";
      toast.error("Camera access denied", { description: errorMsg });
      setChallengeState("idle");
    }
  }, [startCamera]);

  const lastHappyRef = useRef(0);

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

  // Using unknown for Human.js compatibility - cast internally
  const getHappyScore = useCallback((face: unknown): number => {
    const f = face as LocalFaceResult | null;
    const emo = f?.emotion;
    if (!emo) return 0;
    if (Array.isArray(emo)) {
      const happy = emo.find(
        (e) => e?.emotion === "happy" || e?.emotion === "Happy",
      );
      return happy?.score ?? 0;
    }
    if (typeof emo === "object") {
      const emoObj = emo as EmotionScoresObject;
      if (typeof emoObj.happy === "number") return emoObj.happy;
    }
    return 0;
  }, []);

  const getYaw = useCallback((face: unknown): number => {
    const f = face as LocalFaceResult | null;
    const yawRad = f?.rotation?.angle?.yaw;
    return typeof yawRad === "number" ? radToDeg(yawRad) : 0;
  }, []);

  const getPitch = useCallback((face: unknown): number => {
    const f = face as LocalFaceResult | null;
    const pitchRad = f?.rotation?.angle?.pitch;
    return typeof pitchRad === "number" ? radToDeg(pitchRad) : 0;
  }, []);

  const getRoll = useCallback((face: unknown): number => {
    const f = face as LocalFaceResult | null;
    const rollRad = f?.rotation?.angle?.roll;
    return typeof rollRad === "number" ? radToDeg(rollRad) : 0;
  }, []);

  const getFacingDirection = useCallback(
    (result: unknown, face: unknown): FacingDirection => {
      const res = result as LocalDetectionResult | null;
      const gestures = res?.gesture;
      if (Array.isArray(gestures)) {
        for (const g of gestures) {
          const name = g?.gesture ?? g?.name ?? "";
          if (typeof name === "string" && name.startsWith("facing")) {
            if (name.includes("left")) return "left";
            if (name.includes("right")) return "right";
            return "center";
          }
        }
      }
      const yaw = getYaw(face);
      if (yaw < -HEAD_CENTER_THRESHOLD) return "left";
      if (yaw > HEAD_CENTER_THRESHOLD) return "right";
      return "center";
    },
    [getYaw],
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
        // Cast result for Human.js draw API - the actual result from human.detect is compatible
        const res = result as { face?: unknown[] } | null;
        human.draw?.face?.(
          canvas as HTMLCanvasElement,
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
    (result: unknown, face: unknown) => {
      if (!livenessDebugEnabled) return;

      const now = performance.now();
      if (now - debugLastUpdateRef.current < 250) return;
      debugLastUpdateRef.current = now;

      const res = result as LocalDetectionResult | null;
      const video = videoRef.current;
      const gestureNames = Array.isArray(res?.gesture)
        ? res.gesture
            .map((g) => g?.gesture ?? g?.name)
            .filter((n): n is string => typeof n === "string")
        : [];

      const happy = face ? getHappyScore(face) : 0;
      setDebugFrame({
        ts: Date.now(),
        state: challengeState,
        faceDetected: Boolean(face),
        happy,
        baselineHappy: baselineHappyScore,
        deltaHappy: happy - baselineHappyScore,
        yawDeg: face ? getYaw(face) : 0,
        pitchDeg: face ? getPitch(face) : 0,
        rollDeg: face ? getRoll(face) : 0,
        dir: face ? getFacingDirection(result, face) : "center",
        headTurnCentered: headTurnCenteredRef.current,
        consecutiveDetections: consecutiveDetectionsRef.current,
        consecutiveChallengeDetections:
          consecutiveChallengeDetectionsRef.current,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        gesture: gestureNames,
      });
    },
    [
      livenessDebugEnabled,
      videoRef,
      challengeState,
      baselineHappyScore,
      getHappyScore,
      getYaw,
      getPitch,
      getRoll,
      getFacingDirection,
    ],
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

  useEffect(() => {
    if (!livenessDebugEnabled) return;
  }, [livenessDebugEnabled]);

  const checkForFace = useCallback(async () => {
    if (!human || !humanReady || !videoRef.current) return;
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      const raw = await human.detect(videoRef.current);
      const result = human.next(raw);
      const face = result.face?.[0];
      drawDebugOverlay(result);
      updateDebug(result, face ?? null);

      if (face) {
        const dir = getFacingDirection(result, face);
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
  }, [
    human,
    humanReady,
    videoRef,
    drawDebugOverlay,
    updateDebug,
    getFacingDirection,
    getHappyScore,
  ]);

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
          // Enter preparation state to give user time to get ready
          setChallengeState("preparing_challenge");
          setTimeout(() => {
            setChallengeState("waiting_challenge");
          }, CHALLENGE_PREP_DELAY);
        }, CHALLENGE_PASSED_DELAY);
        return;
      }

      // Final verification on server
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
        const data = await res.json();
        if (!res.ok || !data.verified) {
          throw new Error(data.error || "Liveness verification failed");
        }

        setChallengeState("all_passed");
        stopCamera();
        updateData({
          selfieImage: baselineImage,
          bestSelfieFrame: baselineImage,
          blinkCount: null,
        });
        trackLiveness("passed", {
          challengeCount: newCompleted.length,
        });
      } catch (err) {
        setChallengeState("failed");
        toast.error("Verification failed", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        trackLiveness("failed", {
          message: err instanceof Error ? err.message : "unknown",
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
      updateData,
    ],
  );

  const checkCurrentChallenge = useCallback(async () => {
    if (!human || !humanReady || !videoRef.current || !currentChallenge) return;
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      // Capture frame FIRST to ensure we analyze what we submit (fixes race condition)
      const frameDataUrl = captureFrame();
      if (!frameDataUrl) return;

      // Create Image element from captured frame for Human.js detection
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = frameDataUrl;
      });

      // Detect on the captured image, not the live video
      const raw = await human.detect(img);
      const result = human.next(raw);
      const face = result.face?.[0];
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
      const dir = getFacingDirection(result, face);
      const yaw = getYaw(face);

      if (type === "smile") {
        const happyPct = Math.round(happy * 100);
        setChallengeProgress(happyPct);
        const delta = happy - baselineHappyScore;
        // Pass conditions (stricter - must match backend):
        // 1. Standard: happy >= 60% AND delta >= 10%
        // 2. Very high: happy >= 85% (clearly smiling)
        const smilePassed =
          (happy >= SMILE_SCORE_THRESHOLD && delta >= SMILE_DELTA_THRESHOLD) ||
          happy >= SMILE_HIGH_THRESHOLD;
        if (smilePassed) {
          consecutiveChallengeDetectionsRef.current++;
          if (consecutiveChallengeDetectionsRef.current >= STABILITY_FRAMES) {
            consecutiveChallengeDetectionsRef.current = 0;
            // Use the same frame we analyzed (fixes race condition)
            await handleCapturedChallenge("smile", frameDataUrl);
          }
        } else {
          consecutiveChallengeDetectionsRef.current = 0;
        }
      } else if (type === "turn_left" || type === "turn_right") {
        const yawProgress = Math.min(
          (Math.abs(yaw) / HEAD_TURN_YAW_THRESHOLD) * 100,
          100,
        );
        setChallengeProgress(yawProgress);

        if (!headTurnCenteredRef.current) {
          if (dir === "center") {
            headTurnCenteredRef.current = true;
            headTurnStartYawRef.current = yaw; // Store starting yaw
            setStatusMessage("");
          } else {
            setStatusMessage("Center your head to start the turn");
            return;
          }
        }

        const wantsLeft = type === "turn_left";
        const yawDelta = Math.abs(yaw - headTurnStartYawRef.current);
        // Pass if: absolute threshold met OR significant movement from start
        const absolutePass = wantsLeft
          ? yaw < -HEAD_TURN_YAW_THRESHOLD
          : yaw > HEAD_TURN_YAW_THRESHOLD;
        const deltaPass = yawDelta >= HEAD_TURN_DELTA_THRESHOLD;
        const correctDirection = wantsLeft
          ? yaw < headTurnStartYawRef.current
          : yaw > headTurnStartYawRef.current;
        const passed = correctDirection && (absolutePass || deltaPass);
        if (passed) {
          consecutiveChallengeDetectionsRef.current = 0;
          // Use the same frame we analyzed (fixes race condition)
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
    getHappyScore,
    getFacingDirection,
    getYaw,
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
        // Auto-capture baseline
        const baseline = captureFrame();
        if (baseline) {
          setBaselineImage(baseline);
          setBaselineHappyScore(lastHappyRef.current);
          setChallengeState("waiting_challenge");
          setChallengeProgress(0);
          setStatusMessage("");
          consecutiveChallengeDetectionsRef.current = 0;
        } else {
          // Failed to capture - retry
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
    )
      return;

    let lastCheck = 0;
    let animationId: number;

    const detectLoop = (timestamp: number) => {
      // Throttle to DETECTION_INTERVAL
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
      trackLiveness("timeout", { reason: timeoutMessage });
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
    // Reset session state
    setSession(null);
    setCurrentChallenge(null);
    setCompletedChallenges([]);
    consecutiveDetectionsRef.current = 0;
    consecutiveChallengeDetectionsRef.current = 0;
    headTurnCenteredRef.current = false;
    headTurnStartYawRef.current = 0;
    updateData({ selfieImage: null, bestSelfieFrame: null, blinkCount: null });
    beginCamera();
  }, [beginCamera, updateData]);

  const handleSubmit = () => {
    stopCamera();
    nextStep();
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Liveness Verification</h3>
        <p className="text-sm text-muted-foreground">
          We&apos;ll automatically verify you&apos;re a real person. Just start
          the camera and follow the prompts.
        </p>
        {isStreaming && !humanReady && !humanError && (
          <p className="text-xs text-muted-foreground">
            Loading liveness models (first run may take up to a minute).
          </p>
        )}
        {humanError && (
          <p className="text-xs text-muted-foreground">
            Liveness models failed to load. Please retry.
          </p>
        )}
      </div>

      {/* Camera/Image display */}
      <div className="relative aspect-4/3 w-full overflow-hidden rounded-lg bg-muted">
        {(challengeState === "all_passed" || challengeState === "failed") &&
        challengeImage ? (
          <img
            src={challengeImage}
            alt={
              challengeState === "all_passed"
                ? "Verified selfie"
                : "Failed selfie"
            }
            className={`h-full w-full object-cover ${
              challengeState === "failed" ? "opacity-50" : ""
            }`}
          />
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover transform -scale-x-100 ${
                isStreaming ? "" : "hidden"
              }`}
            />
            {livenessDebugEnabled && (
              <canvas
                ref={debugCanvasRef}
                className={`pointer-events-none absolute inset-0 h-full w-full object-cover transform -scale-x-100 ${
                  isStreaming ? "" : "hidden"
                }`}
              />
            )}
            {livenessDebugEnabled && debugFrame && (
              <div className="absolute left-2 top-2 z-10 max-w-[95%] rounded-md bg-black/70 px-2 py-1 text-[10px] leading-snug text-white">
                <div className="font-mono">
                  <div>state: {debugFrame.state}</div>
                  <div>
                    face: {debugFrame.faceDetected ? "yes" : "no"} | video:{" "}
                    {debugFrame.videoWidth}x{debugFrame.videoHeight}
                  </div>
                  <div>
                    happy: {(debugFrame.happy * 100).toFixed(0)}% | base:{" "}
                    {(debugFrame.baselineHappy * 100).toFixed(0)}% | Δ:{" "}
                    {(debugFrame.deltaHappy * 100).toFixed(0)}%
                  </div>
                  <div>
                    yaw: {debugFrame.yawDeg.toFixed(1)}° ({debugFrame.dir}) |
                    centered: {debugFrame.headTurnCentered ? "yes" : "no"}
                  </div>
                  <div>
                    stable: face {debugFrame.consecutiveDetections}/
                    {STABILITY_FRAMES} | challenge{" "}
                    {debugFrame.consecutiveChallengeDetections}/
                    {STABILITY_FRAMES}
                  </div>
                  <div className="opacity-80">
                    req: smile (≥{Math.round(SMILE_SCORE_THRESHOLD * 100)}%+Δ≥
                    {Math.round(SMILE_DELTA_THRESHOLD * 100)}%) OR ≥
                    {Math.round(SMILE_HIGH_THRESHOLD * 100)}%; turn≥
                    {HEAD_TURN_YAW_THRESHOLD}° OR Δ≥{HEAD_TURN_DELTA_THRESHOLD}°
                  </div>
                  {debugFrame.gesture.length > 0 && (
                    <div className="opacity-80">
                      gesture: {debugFrame.gesture.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            )}
            {!isStreaming && (
              <div className="absolute inset-0 flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                {permissionStatus === "denied" ? (
                  <>
                    <CameraOff className="h-12 w-12 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Camera access denied
                    </p>
                  </>
                ) : (
                  <>
                    <Camera className="h-12 w-12 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Click &quot;Start Camera&quot; to begin automatic
                      verification
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* Face positioning guide - visible during detection and challenge states */}
        {(challengeState === "detecting" ||
          challengeState === "waiting_challenge") && (
          <div className="pointer-events-none absolute inset-0">
            <svg
              className="h-full w-full"
              viewBox="0 0 640 480"
              preserveAspectRatio="xMidYMid slice"
              role="img"
              aria-label="Face positioning guide"
            >
              <title>Face positioning guide</title>
              {/* Semi-transparent overlay with face cutout */}
              <defs>
                <mask id="face-mask">
                  <rect x="0" y="0" width="640" height="480" fill="white" />
                  <ellipse cx="320" cy="200" rx="130" ry="170" fill="black" />
                </mask>
              </defs>
              <rect
                x="0"
                y="0"
                width="640"
                height="480"
                fill="rgba(0,0,0,0.3)"
                mask="url(#face-mask)"
              />
              {/* Face oval guide */}
              <ellipse
                cx="320"
                cy="200"
                rx="130"
                ry="170"
                fill="none"
                stroke={
                  challengeState === "waiting_challenge" ? "#eab308" : "#ffffff"
                }
                strokeWidth="3"
                strokeDasharray={
                  challengeState === "detecting" ? "12,6" : "none"
                }
                className={
                  challengeState === "detecting" ? "animate-pulse" : ""
                }
              />
              {/* Corner guides */}
              <g
                stroke={
                  challengeState === "waiting_challenge" ? "#eab308" : "#ffffff"
                }
                strokeWidth="3"
                strokeLinecap="round"
              >
                {/* Top-left */}
                <path d="M 170 50 L 170 90 M 170 50 L 210 50" fill="none" />
                {/* Top-right */}
                <path d="M 470 50 L 470 90 M 470 50 L 430 50" fill="none" />
                {/* Bottom-left */}
                <path d="M 170 400 L 170 360 M 170 400 L 210 400" fill="none" />
                {/* Bottom-right */}
                <path d="M 470 400 L 470 360 M 470 400 L 430 400" fill="none" />
              </g>
            </svg>
          </div>
        )}

        {/* Detecting face overlay */}
        {challengeState === "detecting" && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="rounded-lg bg-background/90 px-4 py-3 shadow-lg backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <Loader2
                  className="h-5 w-5 animate-spin text-primary"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium">{statusMessage}</p>
                  <Progress
                    value={detectionProgress}
                    className="mt-1 h-1 w-32"
                    aria-label={`Face detection progress: ${Math.round(detectionProgress)}%`}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Countdown overlay */}
        {challengeState === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div
              role="timer"
              aria-live="assertive"
              aria-atomic="true"
              className="flex flex-col items-center gap-2"
            >
              <div
                className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-5xl font-bold text-primary-foreground"
                role="status"
                aria-label={`${countdown} seconds remaining`}
              >
                {countdown}
              </div>
              <p className="text-lg font-medium text-white drop-shadow-lg">
                Hold still...
              </p>
            </div>
          </div>
        )}

        {/* Waiting for challenge overlay */}
        {challengeState === "waiting_challenge" && currentChallenge && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="rounded-lg bg-yellow-500/95 px-6 py-4 shadow-lg backdrop-blur"
            >
              <div className="flex items-center gap-3 text-yellow-950">
                {/* Challenge-specific icon */}
                {currentChallenge.challengeType === "smile" && (
                  <Smile className="h-8 w-8" aria-hidden="true" />
                )}
                {currentChallenge.challengeType === "turn_left" && (
                  <ArrowLeft className="h-8 w-8" aria-hidden="true" />
                )}
                {currentChallenge.challengeType === "turn_right" && (
                  <ArrowRight className="h-8 w-8" aria-hidden="true" />
                )}
                <div>
                  <p className="text-xl font-bold">
                    {currentChallenge.instruction}
                  </p>
                  <Progress
                    value={challengeProgress}
                    className="mt-1 h-2 w-40 bg-yellow-200"
                    aria-label={`Challenge progress: ${challengeProgress.toFixed(0)}%`}
                  />
                  {statusMessage &&
                    (currentChallenge.challengeType === "turn_left" ||
                      currentChallenge.challengeType === "turn_right") && (
                      <p className="mt-1 text-xs text-yellow-900">
                        {statusMessage}
                      </p>
                    )}
                  <p className="mt-1 text-xs" aria-hidden="true">
                    {currentChallenge.index + 1} of {currentChallenge.total}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Capturing overlay */}
        {challengeState === "capturing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg bg-green-500/95 px-6 py-4"
            >
              <div className="flex items-center gap-2 text-white">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                <p className="font-medium">
                  {currentChallenge?.title || "Challenge"} detected!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Challenge passed overlay (brief, before next challenge) */}
        {challengeState === "challenge_passed" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg bg-green-500/95 px-6 py-4"
            >
              <div className="flex items-center gap-2 text-white">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
                <p className="font-medium">Great! Next challenge...</p>
              </div>
            </div>
          </div>
        )}

        {/* Preparing for next challenge overlay */}
        {challengeState === "preparing_challenge" && currentChallenge && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg bg-background/95 px-6 py-4 shadow-lg text-center"
            >
              <div className="flex flex-col items-center gap-3">
                {currentChallenge.challengeType === "smile" && (
                  <Smile
                    className="h-12 w-12 text-primary"
                    aria-hidden="true"
                  />
                )}
                {currentChallenge.challengeType === "turn_left" && (
                  <ArrowLeft
                    className="h-12 w-12 text-primary"
                    aria-hidden="true"
                  />
                )}
                {currentChallenge.challengeType === "turn_right" && (
                  <ArrowRight
                    className="h-12 w-12 text-primary"
                    aria-hidden="true"
                  />
                )}
                <p className="text-lg font-bold">Get Ready!</p>
                <p className="text-sm text-muted-foreground">
                  Next: {currentChallenge.instruction}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Validating overlay */}
        {challengeState === "validating" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg bg-background/95 px-6 py-4 shadow-lg"
            >
              <div className="flex items-center gap-3">
                <Loader2
                  className="h-6 w-6 animate-spin text-primary"
                  aria-hidden="true"
                />
                <p className="font-medium">Verifying your identity...</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Permission denied guidance */}
      {permissionStatus === "denied" && (
        <Alert variant="destructive">
          <AlertDescription className="space-y-2">
            <p>Camera access is blocked. To enable:</p>
            <ol className="list-inside list-decimal text-sm">
              <li>Click the camera icon in your browser&apos;s address bar</li>
              <li>Select &quot;Allow&quot; for camera access</li>
              <li>Refresh this page</li>
            </ol>
          </AlertDescription>
        </Alert>
      )}

      {/* Success indicator */}
      {challengeState === "all_passed" && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="ml-2 text-green-700 dark:text-green-300">
            Liveness verified! All {completedChallenges.length} challenges
            passed. Click &quot;Next&quot; to continue.
          </AlertDescription>
        </Alert>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {(challengeState === "idle" || challengeState === "loading_session") &&
          !isStreaming && (
            <Button
              type="button"
              onClick={beginCamera}
              className="flex-1"
              disabled={challengeState === "loading_session"}
            >
              <Camera className="mr-2 h-4 w-4" />
              {challengeState === "loading_session"
                ? "Loading..."
                : "Start Camera"}
            </Button>
          )}

        {(challengeState === "all_passed" ||
          challengeState === "failed" ||
          challengeState === "timeout") && (
          <Button
            type="button"
            variant={challengeState === "all_passed" ? "outline" : "default"}
            onClick={retryChallenge}
            className="flex-1"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {challengeState === "all_passed" ? "Retake" : "Try Again"}
          </Button>
        )}

        {isStreaming &&
          challengeState !== "all_passed" &&
          challengeState !== "failed" &&
          challengeState !== "timeout" && (
            <div className="flex-1 text-center text-sm text-muted-foreground">
              {challengeState === "detecting" && "Looking for your face..."}
              {challengeState === "countdown" && "Get ready..."}
              {challengeState === "preparing_challenge" && "Get ready..."}
              {challengeState === "waiting_challenge" &&
                currentChallenge?.instruction}
              {challengeState === "capturing" && "Capturing..."}
              {challengeState === "validating" && "Verifying..."}
              {challengeState === "challenge_passed" && "Moving to next..."}
            </div>
          )}
      </div>

      <Alert>
        <AlertDescription>
          Your photos are processed securely and never stored. We verify
          you&apos;re a real person through randomized challenges.
        </AlertDescription>
      </Alert>

      <WizardNavigation
        onNext={handleSubmit}
        showSkip
        disableNext={
          challengeState === "validating" ||
          challengeState === "failed" ||
          challengeState === "timeout" ||
          challengeState === "loading_session" ||
          (isStreaming && challengeState !== "all_passed")
        }
      />
    </div>
  );
}
