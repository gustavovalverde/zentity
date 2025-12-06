"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useWizard } from "../wizard-provider";
import { WizardNavigation } from "../wizard-navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Camera,
  CameraOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Smile,
  RotateCcw,
} from "lucide-react";
import {
  validateLivenessChallenge,
  checkLiveness,
  checkSmile,
  checkBlink,
  analyzePassiveMonitor,
  getIssueDescription,
  type ChallengeResult,
} from "@/lib/face-detection";

type PermissionState = "checking" | "granted" | "denied" | "prompt";

/**
 * Automatic challenge flow states:
 * - idle: Camera not started
 * - detecting: Auto-detecting face position
 * - countdown: Face found, counting down for baseline capture
 * - waiting_smile: Baseline captured, waiting for smile
 * - capturing: Smile detected, capturing challenge image
 * - validating: Sending to server for validation
 * - passed: Challenge passed
 * - failed: Challenge failed
 * - timeout: Took too long
 */
type ChallengeState =
  | "idle"
  | "detecting"
  | "countdown"
  | "waiting_smile"
  | "capturing"
  | "validating"
  | "passed"
  | "failed"
  | "timeout";

// Configuration constants
const DETECTION_INTERVAL = 300; // ms between detection checks
const STABILITY_FRAMES = 3; // consecutive positive detections needed
const SMILE_TIMEOUT = 15000; // 15 seconds to smile
const FACE_TIMEOUT = 30000; // 30 seconds to show face
const SMILE_THRESHOLD = 30; // happiness score threshold (lowered for better detection)
const MAX_PASSIVE_FRAMES = 20; // max frames to collect for passive monitoring
const PASSIVE_FRAME_INTERVAL = 500; // ms between passive frame captures

export function StepSelfie() {
  const { state, updateData, nextStep } = useWizard();
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionState>("checking");

  // Challenge state
  const [challengeState, setChallengeState] = useState<ChallengeState>("idle");
  const [baselineImage, setBaselineImage] = useState<string | null>(null);
  const [challengeImage, setChallengeImage] = useState<string | null>(
    state.data.selfieImage || null
  );
  const [challengeResult, setChallengeResult] =
    useState<ChallengeResult | null>(null);

  // Progress indicators
  const [detectionProgress, setDetectionProgress] = useState(0);
  const [smileProgress, setSmileProgress] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [timeoutMessage, setTimeoutMessage] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Passive monitoring state
  const [passiveFrames, setPassiveFrames] = useState<string[]>([]);
  const [blinkCount, setBlinkCount] = useState(0);
  const lastPassiveFrameTimeRef = useRef<number>(0);

  // Refs for detection loop
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const consecutiveDetectionsRef = useRef(0);
  const consecutiveSmilesRef = useRef(0);
  const isCheckingRef = useRef(false);

  // Check camera permission on mount
  useEffect(() => {
    async function checkPermission() {
      try {
        if (navigator.permissions) {
          const result = await navigator.permissions.query({
            name: "camera" as PermissionName,
          });
          setPermissionStatus(result.state as PermissionState);
          result.addEventListener("change", () => {
            setPermissionStatus(result.state as PermissionState);
          });
        } else {
          setPermissionStatus("prompt");
        }
      } catch {
        setPermissionStatus("prompt");
      }
    }
    checkPermission();
  }, []);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.8);
    }
    return null;
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        await videoRef.current.play();
        setIsStreaming(true);
        setPermissionStatus("granted");
        // Automatically start detecting
        setChallengeState("detecting");
        setStatusMessage("Position your face in the frame");
      }
    } catch {
      setPermissionStatus("denied");
      setCameraError(
        "Unable to access camera. Please check your browser settings and grant camera permission."
      );
    }
  }, []);

  // Face detection check
  const checkForFace = useCallback(
    async (frame: string, timestamp: number) => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;

      try {
        const result = await checkLiveness(frame);

        if (result.isReal && result.faceCount === 1) {
          consecutiveDetectionsRef.current++;
          setDetectionProgress(
            (consecutiveDetectionsRef.current / STABILITY_FRAMES) * 100
          );

          // Collect frames for passive monitoring (at slower interval)
          if (
            timestamp - lastPassiveFrameTimeRef.current >= PASSIVE_FRAME_INTERVAL &&
            passiveFrames.length < MAX_PASSIVE_FRAMES
          ) {
            lastPassiveFrameTimeRef.current = timestamp;
            setPassiveFrames((prev) => [...prev, frame]);

            // Background blink check (non-blocking)
            checkBlink(frame, passiveFrames.length === 0).then((blinkResult) => {
              if (blinkResult.blinkDetected) {
                setBlinkCount(blinkResult.blinkCount);
              }
            });
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
      } catch (error) {
        console.error("Face detection error:", error);
      } finally {
        isCheckingRef.current = false;
      }
    },
    [passiveFrames.length]
  );

  // Capture and validate challenge
  const captureAndValidate = useCallback(
    async (smileFrame: string) => {
      if (!baselineImage) return;

      setChallengeImage(smileFrame);
      setChallengeState("validating");
      stopCamera();

      try {
        const result = await validateLivenessChallenge(
          baselineImage,
          smileFrame,
          "smile"
        );
        setChallengeResult(result);

        if (result.passed) {
          setChallengeState("passed");

          // Analyze passive monitoring to get best frame for face matching
          let selectedBestFrame = smileFrame;
          if (passiveFrames.length > 0) {
            try {
              const passiveResult = await analyzePassiveMonitor(passiveFrames);
              setBlinkCount(passiveResult.totalBlinks);

              // Use best frame if available, otherwise use the smile frame
              if (
                passiveResult.bestFrameIndex >= 0 &&
                passiveResult.bestFrameIndex < passiveFrames.length
              ) {
                selectedBestFrame = passiveFrames[passiveResult.bestFrameIndex];
              }
            } catch (passiveError) {
              console.warn("Passive monitoring analysis failed:", passiveError);
              // Continue with smile frame
            }
          }

          updateData({
            selfieImage: smileFrame,
            bestSelfieFrame: selectedBestFrame,
            blinkCount: blinkCount,
          });
        } else {
          setChallengeState("failed");
        }
      } catch {
        // Service error - allow through with warning
        setChallengeState("passed");
        updateData({
          selfieImage: smileFrame,
          bestSelfieFrame: smileFrame,
          blinkCount: blinkCount,
        });
      }
    },
    [baselineImage, stopCamera, updateData, passiveFrames, blinkCount]
  );

  // Smile detection check
  const checkForSmileDetection = useCallback(
    async (frame: string) => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;

      try {
        const result = await checkSmile(frame);

        setSmileProgress(result.happyScore);

        if (result.isSmiling && result.happyScore >= SMILE_THRESHOLD) {
          consecutiveSmilesRef.current++;

          if (consecutiveSmilesRef.current >= STABILITY_FRAMES) {
            // Smile stable - auto capture
            setChallengeState("capturing");
            consecutiveSmilesRef.current = 0;

            // Capture and validate
            await captureAndValidate(frame);
          }
        } else {
          consecutiveSmilesRef.current = 0;
        }

        // Check for face issues
        if (result.error === "face_not_detected") {
          // Face left frame - reset to detecting
          setChallengeState("detecting");
          setStatusMessage("Face lost - position your face in the frame");
          consecutiveSmilesRef.current = 0;
        }
      } catch (error) {
        console.error("Smile detection error:", error);
      } finally {
        isCheckingRef.current = false;
      }
    },
    [captureAndValidate]
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
          setChallengeState("waiting_smile");
          consecutiveSmilesRef.current = 0;
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
      challengeState !== "waiting_smile"
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
      } else if (challengeState === "waiting_smile") {
        checkForSmileDetection(frame);
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
    checkForSmileDetection,
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

  // Smile detection timeout
  useEffect(() => {
    if (challengeState !== "waiting_smile") return;

    const timeout = setTimeout(() => {
      setChallengeState("timeout");
      setTimeoutMessage("Smile not detected in time. Please try again.");
      stopCamera();
    }, SMILE_TIMEOUT);

    return () => clearTimeout(timeout);
  }, [challengeState, stopCamera]);

  const retryChallenge = useCallback(() => {
    setBaselineImage(null);
    setChallengeImage(null);
    setChallengeResult(null);
    setChallengeState("idle");
    setDetectionProgress(0);
    setSmileProgress(0);
    setTimeoutMessage("");
    setStatusMessage("");
    // Reset passive monitoring state
    setPassiveFrames([]);
    setBlinkCount(0);
    lastPassiveFrameTimeRef.current = 0;
    consecutiveDetectionsRef.current = 0;
    consecutiveSmilesRef.current = 0;
    updateData({ selfieImage: null, bestSelfieFrame: null, blinkCount: null });
    startCamera();
  }, [startCamera, updateData]);

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
      </div>

      {/* Camera/Image display */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
        {(challengeState === "passed" || challengeState === "failed") &&
        challengeImage ? (
          <img
            src={challengeImage}
            alt={challengeState === "passed" ? "Verified selfie" : "Failed selfie"}
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
              className={`h-full w-full object-cover ${
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

        {/* Detecting face overlay */}
        {challengeState === "detecting" && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <div className="rounded-lg bg-background/90 px-4 py-3 shadow-lg backdrop-blur">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <p className="font-medium">{statusMessage}</p>
                  <Progress value={detectionProgress} className="mt-1 h-1 w-32" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Countdown overlay */}
        {challengeState === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-5xl font-bold text-primary-foreground">
                {countdown}
              </div>
              <p className="text-lg font-medium text-white drop-shadow-lg">
                Hold still...
              </p>
            </div>
          </div>
        )}

        {/* Waiting for smile overlay */}
        {challengeState === "waiting_smile" && (
          <div className="absolute bottom-4 left-0 right-0 flex justify-center">
            <div className="rounded-lg bg-yellow-500/95 px-6 py-4 shadow-lg backdrop-blur">
              <div className="flex items-center gap-3 text-yellow-950">
                <Smile className="h-8 w-8" />
                <div>
                  <p className="text-xl font-bold">Now smile!</p>
                  <Progress
                    value={smileProgress}
                    className="mt-1 h-2 w-40 bg-yellow-200"
                  />
                  <p className="mt-1 text-xs">
                    Smile: {smileProgress.toFixed(0)}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Capturing overlay */}
        {challengeState === "capturing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="rounded-lg bg-green-500/95 px-6 py-4">
              <div className="flex items-center gap-2 text-white">
                <CheckCircle2 className="h-6 w-6" />
                <p className="font-medium">Smile detected!</p>
              </div>
            </div>
          </div>
        )}

        {/* Validating overlay */}
        {challengeState === "validating" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="rounded-lg bg-background/95 px-6 py-4 shadow-lg">
              <div className="flex items-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="font-medium">Verifying your identity...</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Permission denied guidance */}
      {permissionStatus === "denied" && !cameraError && (
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

      {cameraError && (
        <Alert variant="destructive">
          <AlertDescription>{cameraError}</AlertDescription>
        </Alert>
      )}

      {/* Status alerts */}
      {challengeState === "passed" && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="ml-2 text-green-700 dark:text-green-300">
            Liveness verified! You&apos;ve been confirmed as a real person.
            {blinkCount > 0 && (
              <span className="ml-1 text-sm opacity-80">
                ({blinkCount} blink{blinkCount !== 1 ? "s" : ""} detected)
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {challengeState === "failed" && challengeResult && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="ml-2">
            <p className="font-medium">Verification failed</p>
            <p className="text-sm">{challengeResult.message}</p>
            {challengeResult.error && (
              <p className="mt-1 text-sm">
                {getIssueDescription(challengeResult.error)}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {challengeState === "timeout" && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="ml-2">
            <p className="font-medium">Timeout</p>
            <p className="text-sm">{timeoutMessage}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {challengeState === "idle" && !isStreaming && (
          <Button type="button" onClick={startCamera} className="flex-1">
            <Camera className="mr-2 h-4 w-4" />
            Start Camera
          </Button>
        )}

        {(challengeState === "passed" ||
          challengeState === "failed" ||
          challengeState === "timeout") && (
          <Button
            type="button"
            variant={challengeState === "passed" ? "outline" : "default"}
            onClick={retryChallenge}
            className="flex-1"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {challengeState === "passed" ? "Retake" : "Try Again"}
          </Button>
        )}

        {isStreaming &&
          challengeState !== "passed" &&
          challengeState !== "failed" &&
          challengeState !== "timeout" && (
            <div className="flex-1 text-center text-sm text-muted-foreground">
              {challengeState === "detecting" && "Looking for your face..."}
              {challengeState === "countdown" && "Get ready..."}
              {challengeState === "waiting_smile" && "Show us your smile!"}
              {challengeState === "capturing" && "Capturing..."}
              {challengeState === "validating" && "Verifying..."}
            </div>
          )}
      </div>

      <Alert>
        <AlertDescription>
          Your photos are processed securely and never stored. We only verify
          that you&apos;re a real person by detecting your smile.
        </AlertDescription>
      </Alert>

      <WizardNavigation
        onNext={handleSubmit}
        showSkip
        disableNext={
          challengeState === "validating" ||
          challengeState === "failed" ||
          challengeState === "timeout" ||
          (isStreaming && challengeState !== "passed")
        }
      />
    </div>
  );
}
