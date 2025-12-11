"use client";

/* eslint @next/next/no-img-element: off */

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Eye,
  Loader2,
  RotateCcw,
  Smile,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useLivenessCamera } from "@/hooks/use-liveness-camera";
import { trackCameraPermission, trackLiveness } from "@/lib/analytics";
import {
  analyzePassiveMonitor,
  type ChallengeInfo,
  type ChallengeResult,
  type ChallengeSession,
  type ChallengeType,
  checkBlink,
  checkHeadTurn,
  checkLiveness,
  checkSmile,
  completeChallengeInSession,
  createChallengeSession,
  validateLivenessChallenge,
} from "@/lib/face-detection";
import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

/**
 * Automatic challenge flow states:
 * - idle: Camera not started
 * - loading_session: Creating challenge session from backend
 * - detecting: Auto-detecting face position
 * - countdown: Face found, counting down for baseline capture
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
const SMILE_THRESHOLD = 30; // happiness score threshold (lowered for better detection)
const BLINK_EAR_THRESHOLD = 0.21; // EAR threshold for blink detection
const HEAD_TURN_THRESHOLD = 0.1; // yaw threshold for head turn (lowered for easier detection)
const MAX_PASSIVE_FRAMES = 20; // max frames to collect for passive monitoring
const PASSIVE_FRAME_INTERVAL = 500; // ms between passive frame captures
const WARMUP_TIMEOUT = 45_000; // allow models to load on cold start
const LIVENESS_PING_INTERVAL = 3000;
const LIVENESS_THROTTLE_MS = 800;
const NUM_CHALLENGES = 2; // number of random challenges
const CHALLENGE_PASSED_DELAY = 1000; // ms to show "passed" before next challenge
const DUMMY_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6nXegAAAAASUVORK5CYII=";

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
  const [challengeResult, setChallengeResult] =
    useState<ChallengeResult | null>(null);

  // Multi-challenge session state
  const [session, setSession] = useState<ChallengeSession | null>(null);
  const [currentChallenge, setCurrentChallenge] =
    useState<ChallengeInfo | null>(null);
  const [completedChallenges, setCompletedChallenges] = useState<
    Array<{ type: ChallengeType; passed: boolean }>
  >([]);

  // Progress indicators
  const [detectionProgress, setDetectionProgress] = useState(0);
  const [challengeProgress, setChallengeProgress] = useState(0); // Generic progress for any challenge
  const [countdown, setCountdown] = useState(3);
  const [timeoutMessage, setTimeoutMessage] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [warmupStatus, setWarmupStatus] = useState<
    "idle" | "warming" | "ready" | "failed"
  >("idle");

  // Passive monitoring state
  const [passiveFrames, setPassiveFrames] = useState<string[]>([]);
  const [blinkCount, setBlinkCount] = useState(0);
  const lastPassiveFrameTimeRef = useRef<number>(0);

  // Refs for detection loop
  const consecutiveDetectionsRef = useRef(0);
  const consecutiveChallengeDetectionsRef = useRef(0); // For any challenge type
  const isCheckingRef = useRef(false);
  const lastLivenessCallRef = useRef(0);

  // Track permission changes for analytics and UX hints
  useEffect(() => {
    trackCameraPermission(permissionStatus);
  }, [permissionStatus]);

  // Warmup liveness service - defined before useEffect that calls it
  const warmupLiveness = useCallback(async () => {
    if (warmupStatus === "ready") return true;
    setWarmupStatus("warming");

    // Fire-and-forget a dummy liveness call to trigger model downloads
    void fetch("/api/liveness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: DUMMY_PIXEL, threshold: 0 }),
    }).catch(() => {});

    const start = Date.now();
    while (Date.now() - start < WARMUP_TIMEOUT) {
      try {
        const res = await fetch("/api/liveness/health");
        if (res.ok) {
          setWarmupStatus("ready");
          return true;
        }
      } catch {
        // ignore and retry
      }
      await new Promise((r) => setTimeout(r, LIVENESS_PING_INTERVAL));
    }
    setWarmupStatus("failed");
    toast.error("Liveness service still warming up", {
      description: "Models are downloading. Please wait 30-60s then retry.",
    });
    return false;
  }, [warmupStatus]);

  // Start warmup as soon as the step renders to reduce first-call wait
  useEffect(() => {
    void warmupLiveness();
  }, [warmupLiveness]);

  const beginCamera = useCallback(async () => {
    const ready = await warmupLiveness();
    if (!ready) return;

    // Create a challenge session first
    setChallengeState("loading_session");
    try {
      const newSession = await createChallengeSession(NUM_CHALLENGES);
      setSession(newSession);
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
  }, [startCamera, warmupLiveness]);

  // Face detection check
  const checkForFace = useCallback(
    async (frame: string, timestamp: number) => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;

      try {
        const now = performance.now();
        if (now - lastLivenessCallRef.current < LIVENESS_THROTTLE_MS) {
          return;
        }
        lastLivenessCallRef.current = now;

        const result = await checkLiveness(frame);

        if (result.isReal && result.faceCount === 1) {
          consecutiveDetectionsRef.current++;
          setDetectionProgress(
            (consecutiveDetectionsRef.current / STABILITY_FRAMES) * 100,
          );

          // Collect frames for passive monitoring (at slower interval)
          if (
            timestamp - lastPassiveFrameTimeRef.current >=
              PASSIVE_FRAME_INTERVAL &&
            passiveFrames.length < MAX_PASSIVE_FRAMES
          ) {
            lastPassiveFrameTimeRef.current = timestamp;
            setPassiveFrames((prev) => [...prev, frame]);

            // Background blink check (non-blocking)
            await checkBlink(frame, passiveFrames.length === 0).then(
              (blinkResult) => {
                if (blinkResult.blinkDetected) {
                  setBlinkCount(blinkResult.blinkCount);
                }
              },
            );
          }

          if (consecutiveDetectionsRef.current >= STABILITY_FRAMES) {
            // Face stable - start countdown
            setChallengeState("countdown");
            consecutiveDetectionsRef.current = 0;
          }
        } else {
          consecutiveDetectionsRef.current = 0;
          setDetectionProgress(0);

          // Provide feedback on what's wrong
          if (result.faceCount === 0) {
            setStatusMessage("Position your face in the frame");
          } else if (result.faceCount > 1) {
            setStatusMessage("Only one person should be in frame");
          } else if (result.issues?.includes("face_too_small")) {
            setStatusMessage("Move closer to the camera");
          } else if (result.issues?.includes("face_obscured")) {
            setStatusMessage("Make sure your face is clearly visible");
          }
        }
      } catch (_error) {
      } finally {
        isCheckingRef.current = false;
      }
    },
    [passiveFrames.length],
  );

  // Handle challenge completion and move to next
  const handleChallengeComplete = useCallback(
    async (
      challengeFrame: string,
      challengeType: ChallengeType,
      passed: boolean,
    ) => {
      if (!session || !baselineImage) return;

      setChallengeImage(challengeFrame);

      // Record completion in session
      const result = await completeChallengeInSession(
        session.sessionId,
        challengeType,
        passed,
      );

      // Track this challenge as completed
      setCompletedChallenges((prev) => [
        ...prev,
        { type: challengeType, passed },
      ]);

      if (!passed) {
        setChallengeState("failed");
        setChallengeResult({
          passed: false,
          challengeType,
          message: `${currentChallenge?.title || "Challenge"} failed. Please try again.`,
          processingTimeMs: 0,
        });
        stopCamera();
        return;
      }

      if (result.sessionComplete && result.sessionPassed) {
        // All challenges passed!
        setChallengeState("all_passed");
        stopCamera();

        // Select the best frame for face matching
        let selectedBestFrame = baselineImage;
        if (passiveFrames.length > 0) {
          try {
            const passiveResult = await analyzePassiveMonitor(passiveFrames);
            setBlinkCount(passiveResult.totalBlinks);
            if (
              passiveResult.bestFrameIndex >= 0 &&
              passiveResult.bestFrameIndex < passiveFrames.length &&
              passiveResult.bestFrameScore > 0.7
            ) {
              const candidateFrame =
                passiveFrames[passiveResult.bestFrameIndex];
              if (
                candidateFrame &&
                candidateFrame.length > 1000 &&
                candidateFrame.startsWith("data:image/")
              ) {
                selectedBestFrame = candidateFrame;
              }
            }
          } catch {
            // Continue with baseline
          }
        }

        updateData({
          selfieImage: challengeFrame,
          bestSelfieFrame: selectedBestFrame,
          blinkCount: blinkCount,
        });
      } else if (result.nextChallenge) {
        // More challenges to go - show passed briefly then move to next
        setChallengeState("challenge_passed");

        // After a brief delay, start the next challenge
        setTimeout(() => {
          setCurrentChallenge(result.nextChallenge);
          setChallengeProgress(0);
          consecutiveChallengeDetectionsRef.current = 0;
          setChallengeState("waiting_challenge");
        }, CHALLENGE_PASSED_DELAY);
      }
    },
    [
      session,
      baselineImage,
      currentChallenge,
      passiveFrames,
      blinkCount,
      stopCamera,
      updateData,
    ],
  );

  // Capture and validate challenge
  const captureAndValidate = useCallback(
    async (challengeFrame: string) => {
      if (!baselineImage || !currentChallenge) return;

      setChallengeState("validating");

      try {
        // For smile, use the existing validation endpoint
        if (currentChallenge.challengeType === "smile") {
          const result = await validateLivenessChallenge(
            baselineImage,
            challengeFrame,
            "smile",
          );
          setChallengeResult(result);
          await handleChallengeComplete(challengeFrame, "smile", result.passed);
        } else {
          // For other challenges, they're validated in real-time during detection
          // Just mark as passed since we got here via successful detection
          await handleChallengeComplete(
            challengeFrame,
            currentChallenge.challengeType,
            true,
          );
        }
      } catch {
        // Service error - allow through with warning
        await handleChallengeComplete(
          challengeFrame,
          currentChallenge.challengeType,
          true,
        );
      }
    },
    [baselineImage, currentChallenge, handleChallengeComplete],
  );

  // Generic challenge detection for current challenge type
  const checkCurrentChallenge = useCallback(
    async (frame: string) => {
      if (isCheckingRef.current || !currentChallenge) return;
      isCheckingRef.current = true;

      try {
        const challengeType = currentChallenge.challengeType;

        if (challengeType === "smile") {
          const result = await checkSmile(frame);
          setChallengeProgress(result.happyScore);

          if (result.isSmiling && result.happyScore >= SMILE_THRESHOLD) {
            consecutiveChallengeDetectionsRef.current++;
            if (consecutiveChallengeDetectionsRef.current >= STABILITY_FRAMES) {
              setChallengeState("capturing");
              consecutiveChallengeDetectionsRef.current = 0;
              await captureAndValidate(frame);
            }
          } else {
            consecutiveChallengeDetectionsRef.current = 0;
          }

          if (result.error === "face_not_detected") {
            setChallengeState("detecting");
            setStatusMessage("Face lost - position your face in the frame");
            consecutiveChallengeDetectionsRef.current = 0;
          }
        } else if (challengeType === "blink") {
          const result = await checkBlink(frame, false);
          setChallengeProgress(
            result.blinkDetected ? 100 : (1 - result.earValue / 0.3) * 100,
          );

          if (result.blinkDetected || result.earValue < BLINK_EAR_THRESHOLD) {
            consecutiveChallengeDetectionsRef.current++;
            if (consecutiveChallengeDetectionsRef.current >= 1) {
              // Blink needs only 1 detection
              setChallengeState("capturing");
              consecutiveChallengeDetectionsRef.current = 0;
              await captureAndValidate(frame);
            }
          }

          if (!result.faceDetected) {
            setChallengeState("detecting");
            setStatusMessage("Face lost - position your face in the frame");
            consecutiveChallengeDetectionsRef.current = 0;
          }
        } else if (
          challengeType === "turn_left" ||
          challengeType === "turn_right"
        ) {
          const direction = challengeType === "turn_left" ? "left" : "right";
          const result = await checkHeadTurn(
            frame,
            direction,
            HEAD_TURN_THRESHOLD,
          );

          // Show yaw as progress (normalized)
          const yawProgress = Math.min(
            (Math.abs(result.yaw) / HEAD_TURN_THRESHOLD) * 100,
            100,
          );
          setChallengeProgress(yawProgress);

          if (result.turnDetected && result.meetsThreshold) {
            // Head turn needs only 1 detection (deliberate action, like blink)
            setChallengeState("capturing");
            consecutiveChallengeDetectionsRef.current = 0;
            await captureAndValidate(frame);
          }

          if (result.error?.includes("No face")) {
            setChallengeState("detecting");
            setStatusMessage("Face lost - position your face in the frame");
            consecutiveChallengeDetectionsRef.current = 0;
          }
        }
      } catch (_error) {
        // Ignore errors during detection loop
      } finally {
        isCheckingRef.current = false;
      }
    },
    [currentChallenge, captureAndValidate],
  );

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
          setChallengeState("waiting_challenge");
          setChallengeProgress(0);
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

      // Capture current frame
      const frame = captureFrame();
      if (!frame) {
        animationId = requestAnimationFrame(detectLoop);
        return;
      }

      // Detection based on current state
      if (challengeState === "detecting") {
        checkForFace(frame, timestamp);
      } else if (challengeState === "waiting_challenge") {
        checkCurrentChallenge(frame);
      }

      animationId = requestAnimationFrame(detectLoop);
    };

    animationId = requestAnimationFrame(detectLoop);
    return () => cancelAnimationFrame(animationId);
  }, [
    isStreaming,
    challengeState,
    captureFrame,
    checkForFace,
    checkCurrentChallenge,
  ]);

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
      trackLiveness("passed", {
        blinkCount,
        challengeCount: completedChallenges.length,
      });
    }
  }, [challengeState, blinkCount, completedChallenges.length]);

  useEffect(() => {
    if (challengeState === "challenge_passed" && currentChallenge) {
      toast.success(`${currentChallenge.title} passed!`, {
        description: "Moving to next challenge...",
        duration: CHALLENGE_PASSED_DELAY,
      });
    }
  }, [challengeState, currentChallenge]);

  useEffect(() => {
    if (challengeState === "failed" && challengeResult) {
      toast.error("Verification failed", {
        description: challengeResult.message || "Please try again.",
      });
      trackLiveness("failed", { message: challengeResult.message });
    }
  }, [challengeState, challengeResult]);

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
    setChallengeResult(null);
    setChallengeState("idle");
    setDetectionProgress(0);
    setChallengeProgress(0);
    setTimeoutMessage("");
    setStatusMessage("");
    // Reset session state
    setSession(null);
    setCurrentChallenge(null);
    setCompletedChallenges([]);
    // Reset passive monitoring state
    setPassiveFrames([]);
    setBlinkCount(0);
    lastPassiveFrameTimeRef.current = 0;
    consecutiveDetectionsRef.current = 0;
    consecutiveChallengeDetectionsRef.current = 0;
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
        {warmupStatus !== "ready" && (
          <p className="text-xs text-muted-foreground">
            {warmupStatus === "warming"
              ? "Warming up liveness models (first run may take up to a minute)."
              : warmupStatus === "failed"
                ? "Liveness models are still loading. Please wait a bit and retry."
                : "We&apos;ll warm up liveness models when you start."}
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
                {currentChallenge.challengeType === "blink" && (
                  <Eye className="h-8 w-8" aria-hidden="true" />
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
              disabled={
                warmupStatus === "warming" ||
                challengeState === "loading_session"
              }
            >
              <Camera className="mr-2 h-4 w-4" />
              {challengeState === "loading_session"
                ? "Loading..."
                : warmupStatus === "warming"
                  ? "Warming up..."
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
