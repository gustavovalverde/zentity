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
import { useCallback } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { STABILITY_FRAMES, useSelfieLivenessFlow } from "@/hooks/liveness";
import { useHumanLiveness } from "@/hooks/use-human-liveness";
import { useLivenessCamera } from "@/hooks/use-liveness-camera";
import {
  getLivenessDebugEnabled,
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "@/lib/liveness";

import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

const HEAD_TURN_YAW_THRESHOLD = TURN_YAW_ABSOLUTE_THRESHOLD_DEG;
const HEAD_TURN_DELTA_THRESHOLD = TURN_YAW_SIGNIFICANT_DELTA_DEG;

export function StepSelfie() {
  const { state, updateData, nextStep, skipLiveness, reset } = useWizard();
  const {
    videoRef,
    isStreaming,
    permissionStatus,
    startCamera,
    stopCamera,
    captureFrame,
    captureStreamFrame,
    getSquareDetectionCanvas,
  } = useLivenessCamera({
    facingMode: "user",
    idealWidth: 640,
    idealHeight: 480,
  });
  const livenessDebugEnabled = getLivenessDebugEnabled();

  const {
    human,
    ready: humanReady,
    error: humanError,
  } = useHumanLiveness(isStreaming);

  // Memoize callbacks to prevent infinite re-render loops in the liveness flow hook
  const handleVerified = useCallback(
    ({
      selfieImage,
      bestSelfieFrame,
      blinkCount,
    }: {
      selfieImage: string;
      bestSelfieFrame: string;
      blinkCount: number | null;
    }) => {
      updateData({ selfieImage, bestSelfieFrame, blinkCount });
    },
    [updateData],
  );

  const handleReset = useCallback(() => {
    updateData({
      selfieImage: null,
      bestSelfieFrame: null,
      blinkCount: null,
    });
  }, [updateData]);

  const {
    challengeState,
    challengeImage,
    currentChallenge,
    completedChallenges,
    detectionProgress,
    challengeProgress,
    countdown,
    statusMessage,
    serverProgress,
    serverHint,
    debugCanvasRef,
    debugFrame,
    lastVerifyError,
    lastVerifyResponse,
    beginCamera,
    retryChallenge,
  } = useSelfieLivenessFlow({
    videoRef,
    isStreaming,
    startCamera,
    stopCamera,
    captureFrame,
    captureStreamFrame,
    getSquareDetectionCanvas,
    human,
    humanReady,
    livenessDebugEnabled,
    initialSelfieImage: state.data.selfieImage || null,
    onVerified: handleVerified,
    onReset: handleReset,
    onSessionError: reset,
  });
  const handleSubmit = () => {
    stopCamera();
    nextStep();
  };

  const handleSkipChallenges = async () => {
    try {
      // Capture a single selfie frame (no challenge flow) and continue.
      if (!isStreaming) {
        await startCamera();
      }

      const deadline = Date.now() + 3000;
      let frame: string | null = null;
      while (!frame && Date.now() < deadline) {
        frame = captureFrame();
        if (!frame) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      if (!frame) {
        toast.error("Could not capture selfie", {
          description:
            "Please try again. If the issue persists, ensure camera access is allowed.",
        });
        return;
      }

      updateData({
        selfieImage: frame,
        bestSelfieFrame: frame,
        blinkCount: null,
      });
      stopCamera();
      await skipLiveness();
    } catch {
      toast.error("Camera unavailable", {
        description:
          "Please allow camera access to continue, or try again in a different browser.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Liveness Verification</h3>
        <p className="text-sm text-muted-foreground">
          We&apos;ll automatically verify you&apos;re a real person. Just start
          the camera and follow the prompts.
        </p>
        <p className="text-xs text-muted-foreground">
          We&apos;ll ask for camera access next. Photos are used only for
          verification and are not stored.
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
                className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
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
                  {debugFrame.performance && (
                    <div className="opacity-80">
                      perf: detect {debugFrame.performance.detect?.toFixed(0)}ms
                      | total {debugFrame.performance.total?.toFixed(0)}ms
                    </div>
                  )}
                  {lastVerifyError && (
                    <div className="mt-1 text-red-200">
                      verify: {lastVerifyError}
                    </div>
                  )}
                  {Boolean(lastVerifyResponse) && (
                    <details className="mt-1 opacity-80">
                      <summary className="cursor-pointer">
                        verify payload
                      </summary>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap wrap-break-words">
                        {JSON.stringify(lastVerifyResponse, null, 2)}
                      </pre>
                    </details>
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
                  {/* Dual progress bars */}
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-14">You:</span>
                      <Progress
                        value={challengeProgress}
                        className="h-2 w-32 bg-yellow-200"
                        aria-label={`Your progress: ${challengeProgress.toFixed(0)}%`}
                      />
                      <span className="text-xs w-8">
                        {challengeProgress.toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-14">Server:</span>
                      <Progress
                        value={serverProgress?.progress ?? 0}
                        className="h-2 w-32 bg-yellow-200"
                        aria-label={`Server progress: ${serverProgress?.progress ?? 0}%`}
                      />
                      <span className="text-xs w-8">
                        {serverProgress?.progress ?? 0}%
                      </span>
                    </div>
                  </div>
                  {/* Server hint */}
                  {serverHint && (
                    <p className="mt-2 text-xs text-yellow-900 font-medium">
                      {serverHint}
                    </p>
                  )}
                  {/* Fallback to status message for turn challenges */}
                  {!serverHint &&
                    statusMessage &&
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
        skipLabel="Skip challenges"
        onSkip={handleSkipChallenges}
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
