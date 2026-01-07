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
import { STABILITY_FRAMES } from "@/hooks/liveness/constants";
import { useSelfieLivenessFlow } from "@/hooks/liveness/use-selfie-liveness-flow";
import { useHumanLiveness } from "@/hooks/use-human-liveness";
import { useLivenessCamera } from "@/hooks/use-liveness-camera";
import {
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "@/lib/liveness/liveness-policy";
import { trpc } from "@/lib/trpc/client";

/** Debug mode - shows detection overlay and metrics */
const debugEnabled = process.env.NEXT_PUBLIC_DEBUG === "1";

import { WizardNavigation } from "../wizard-navigation";
import { useWizard } from "../wizard-provider";

const HEAD_TURN_YAW_THRESHOLD = TURN_YAW_ABSOLUTE_THRESHOLD_DEG;
const HEAD_TURN_DELTA_THRESHOLD = TURN_YAW_SIGNIFICANT_DELTA_DEG;

export function StepSelfie() {
  const {
    state,
    updateData,
    nextStep,
    skipLiveness,
    reset,
    setSubmitting,
    updateServerProgress,
  } = useWizard();
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
    [updateData]
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
    debugEnabled,
    initialSelfieImage: state.data.selfieImage || null,
    onVerified: handleVerified,
    onReset: handleReset,
    onSessionError: reset,
  });
  const handleSubmit = async () => {
    stopCamera();

    const selfieToVerify = state.data.bestSelfieFrame || state.data.selfieImage;
    if (!selfieToVerify) {
      toast.error("Missing selfie", {
        description: "Please complete the selfie step before continuing.",
      });
      return;
    }
    if (!(state.data.idDocumentBase64 && state.data.identityDraftId)) {
      toast.error("Missing document context", {
        description:
          "Please re-upload your ID so we can complete verification.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await trpc.identity.prepareLiveness.mutate({
        draftId: state.data.identityDraftId,
        documentImage: state.data.idDocumentBase64,
        selfieImage: selfieToVerify,
      });

      await updateServerProgress({
        livenessPassed: response.livenessPassed,
        faceMatchPassed: response.faceMatchPassed,
        step: 4,
      });

      nextStep();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to prepare liveness verification.";
      toast.error("Verification failed", { description: message });
    } finally {
      setSubmitting(false);
    }
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
      if (!(state.data.idDocumentBase64 && state.data.identityDraftId)) {
        toast.error("Missing document context", {
          description:
            "Please re-upload your ID so we can complete verification.",
        });
        return;
      }

      setSubmitting(true);
      const response = await trpc.identity.prepareLiveness.mutate({
        draftId: state.data.identityDraftId,
        documentImage: state.data.idDocumentBase64,
        selfieImage: frame,
      });
      await updateServerProgress({
        livenessPassed: response.livenessPassed,
        faceMatchPassed: response.faceMatchPassed,
        step: 4,
      });
      await skipLiveness();
    } catch {
      toast.error("Camera unavailable", {
        description:
          "Please allow camera access to continue, or try again in a different browser.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="font-medium text-lg">Liveness Verification</h3>
        <p className="text-muted-foreground text-sm">
          We&apos;ll automatically verify you&apos;re a real person. Just start
          the camera and follow the prompts.
        </p>
        <p className="text-muted-foreground text-xs">
          We&apos;ll ask for camera access next. Photos are used only for
          verification and are not stored.
        </p>
        {isStreaming && !humanReady && !humanError && (
          <p className="text-muted-foreground text-xs">
            Loading liveness models (first run may take up to a minute).
          </p>
        )}
        {humanError ? (
          <p className="text-muted-foreground text-xs">
            Liveness models failed to load. Please retry.
          </p>
        ) : null}
      </div>

      {/* Camera/Image display */}
      <div className="relative aspect-4/3 w-full overflow-hidden rounded-lg bg-muted">
        {(challengeState === "all_passed" || challengeState === "failed") &&
        challengeImage ? (
          <img
            alt={
              challengeState === "all_passed"
                ? "Verified selfie"
                : "Failed selfie"
            }
            className={`h-full w-full object-cover ${
              challengeState === "failed" ? "opacity-50" : ""
            }`}
            height={480}
            src={challengeImage}
            width={640}
          />
        ) : (
          <>
            <video
              autoPlay
              className={`h-full w-full -scale-x-100 transform object-cover ${
                isStreaming ? "" : "hidden"
              }`}
              muted
              playsInline
              ref={videoRef}
            />
            {debugEnabled ? (
              <canvas
                className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
                  isStreaming ? "" : "hidden"
                }`}
                ref={debugCanvasRef}
              />
            ) : null}
            {debugEnabled && debugFrame ? (
              <div className="absolute top-2 left-2 z-10 max-w-[95%] rounded-md bg-black/70 px-2 py-1 text-[10px] text-white leading-snug">
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
                  {debugFrame.performance ? (
                    <div className="opacity-80">
                      perf: detect {debugFrame.performance.detect?.toFixed(0)}ms
                      | total {debugFrame.performance.total?.toFixed(0)}ms
                    </div>
                  ) : null}
                  {lastVerifyError ? (
                    <div className="mt-1 text-destructive/80">
                      verify: {lastVerifyError}
                    </div>
                  ) : null}
                  {Boolean(lastVerifyResponse) && (
                    <details className="mt-1 opacity-80">
                      <summary className="cursor-pointer">
                        verify payload
                      </summary>
                      <pre className="wrap-break-words mt-1 max-h-32 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(lastVerifyResponse, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            ) : null}
            {!isStreaming && (
              <div className="absolute inset-0 flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                {permissionStatus === "denied" ? (
                  <>
                    <CameraOff className="h-12 w-12 text-muted-foreground" />
                    <p className="text-muted-foreground text-sm">
                      Camera access denied
                    </p>
                  </>
                ) : (
                  <>
                    <Camera className="h-12 w-12 text-muted-foreground" />
                    <p className="text-muted-foreground text-sm">
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
              aria-label="Face positioning guide"
              className="h-full w-full"
              preserveAspectRatio="xMidYMid slice"
              role="img"
              viewBox="0 0 640 480"
            >
              <title>Face positioning guide</title>
              {/* Semi-transparent overlay with face cutout */}
              <defs>
                <mask id="face-mask">
                  <rect fill="white" height="480" width="640" x="0" y="0" />
                  <ellipse cx="320" cy="200" fill="black" rx="130" ry="170" />
                </mask>
              </defs>
              <rect
                fill="rgba(0,0,0,0.3)"
                height="480"
                mask="url(#face-mask)"
                width="640"
                x="0"
                y="0"
              />
              {/* Face oval guide */}
              <ellipse
                className={
                  challengeState === "detecting" ? "animate-pulse" : ""
                }
                cx="320"
                cy="200"
                fill="none"
                rx="130"
                ry="170"
                stroke={
                  challengeState === "waiting_challenge"
                    ? "var(--warning)"
                    : "var(--foreground)"
                }
                strokeDasharray={
                  challengeState === "detecting" ? "12,6" : "none"
                }
                strokeWidth="3"
              />
              {/* Corner guides */}
              <g
                stroke={
                  challengeState === "waiting_challenge"
                    ? "var(--warning)"
                    : "var(--foreground)"
                }
                strokeLinecap="round"
                strokeWidth="3"
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
          <div className="absolute right-0 bottom-4 left-0 flex justify-center">
            <output
              aria-atomic="true"
              aria-live="polite"
              className="block rounded-lg bg-background/90 px-4 py-3 shadow-lg backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <Loader2
                  aria-hidden="true"
                  className="h-5 w-5 animate-spin text-primary"
                />
                <div>
                  <p className="font-medium">{statusMessage}</p>
                  <Progress
                    aria-label={`Face detection progress: ${Math.round(detectionProgress)}%`}
                    className="mt-1 h-1 w-32"
                    value={detectionProgress}
                  />
                </div>
              </div>
            </output>
          </div>
        )}

        {/* Countdown overlay */}
        {challengeState === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div
              aria-atomic="true"
              aria-live="assertive"
              className="flex flex-col items-center gap-2"
              role="timer"
            >
              <output
                aria-label={`${countdown} seconds remaining`}
                className="flex h-24 w-24 items-center justify-center rounded-full bg-primary font-bold text-5xl text-primary-foreground"
              >
                {countdown}
              </output>
              <p className="font-medium text-lg text-white drop-shadow-lg">
                Hold still...
              </p>
            </div>
          </div>
        )}

        {/* Waiting for challenge overlay */}
        {challengeState === "waiting_challenge" && currentChallenge && (
          <div className="absolute right-0 bottom-4 left-0 flex justify-center">
            <output
              aria-atomic="true"
              aria-live="polite"
              className="block rounded-lg bg-warning/90 px-6 py-4 shadow-lg backdrop-blur"
            >
              <div className="flex items-center gap-3 text-warning-foreground">
                {/* Challenge-specific icon */}
                {currentChallenge.challengeType === "smile" && (
                  <Smile aria-hidden="true" className="h-8 w-8" />
                )}
                {currentChallenge.challengeType === "turn_left" && (
                  <ArrowLeft aria-hidden="true" className="h-8 w-8" />
                )}
                {currentChallenge.challengeType === "turn_right" && (
                  <ArrowRight aria-hidden="true" className="h-8 w-8" />
                )}
                <div>
                  <p className="font-bold text-xl">
                    {currentChallenge.instruction}
                  </p>
                  {/* Dual progress bars */}
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-xs">You:</span>
                      <Progress
                        aria-label={`Your progress: ${challengeProgress.toFixed(0)}%`}
                        className="h-2 w-32 bg-warning/20"
                        indicatorClassName="bg-warning"
                        value={challengeProgress}
                      />
                      <span className="w-8 text-xs">
                        {challengeProgress.toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-xs">Server:</span>
                      <Progress
                        aria-label={`Server progress: ${serverProgress?.progress ?? 0}%`}
                        className="h-2 w-32 bg-warning/20"
                        indicatorClassName="bg-warning"
                        value={serverProgress?.progress ?? 0}
                      />
                      <span className="w-8 text-xs">
                        {serverProgress?.progress ?? 0}%
                      </span>
                    </div>
                  </div>
                  {/* Server hint */}
                  {serverHint ? (
                    <p className="mt-2 font-medium text-warning-foreground text-xs">
                      {serverHint}
                    </p>
                  ) : null}
                  {/* Fallback to status message for turn challenges */}
                  {!serverHint &&
                    statusMessage &&
                    (currentChallenge.challengeType === "turn_left" ||
                      currentChallenge.challengeType === "turn_right") && (
                      <p className="mt-1 text-warning-foreground text-xs">
                        {statusMessage}
                      </p>
                    )}
                  <p aria-hidden="true" className="mt-1 text-xs">
                    {currentChallenge.index + 1} of {currentChallenge.total}
                  </p>
                </div>
              </div>
            </output>
          </div>
        )}

        {/* Capturing overlay */}
        {challengeState === "capturing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <output
              aria-live="polite"
              className="block rounded-lg bg-success/90 px-6 py-4"
            >
              <div className="flex items-center gap-2 text-success-foreground">
                <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
                <p className="font-medium">
                  {currentChallenge?.title || "Challenge"} detected!
                </p>
              </div>
            </output>
          </div>
        )}

        {/* Challenge passed overlay (brief, before next challenge) */}
        {challengeState === "challenge_passed" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <output
              aria-live="polite"
              className="block rounded-lg bg-success/90 px-6 py-4"
            >
              <div className="flex items-center gap-2 text-success-foreground">
                <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
                <p className="font-medium">Great! Next challenge...</p>
              </div>
            </output>
          </div>
        )}

        {/* Preparing for next challenge overlay */}
        {challengeState === "preparing_challenge" && currentChallenge && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <output
              aria-live="polite"
              className="block rounded-lg bg-background/95 px-6 py-4 text-center shadow-lg"
            >
              <div className="flex flex-col items-center gap-3">
                {currentChallenge.challengeType === "smile" && (
                  <Smile
                    aria-hidden="true"
                    className="h-12 w-12 text-primary"
                  />
                )}
                {currentChallenge.challengeType === "turn_left" && (
                  <ArrowLeft
                    aria-hidden="true"
                    className="h-12 w-12 text-primary"
                  />
                )}
                {currentChallenge.challengeType === "turn_right" && (
                  <ArrowRight
                    aria-hidden="true"
                    className="h-12 w-12 text-primary"
                  />
                )}
                <p className="font-bold text-lg">Get Ready!</p>
                <p className="text-muted-foreground text-sm">
                  Next: {currentChallenge.instruction}
                </p>
              </div>
            </output>
          </div>
        )}

        {/* Validating overlay */}
        {challengeState === "validating" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <output
              aria-live="polite"
              className="block rounded-lg bg-background/95 px-6 py-4 shadow-lg"
            >
              <div className="flex items-center gap-3">
                <Loader2
                  aria-hidden="true"
                  className="h-6 w-6 animate-spin text-primary"
                />
                <p className="font-medium">Verifying your identity...</p>
              </div>
            </output>
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
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="ml-2">
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
              className="flex-1"
              disabled={challengeState === "loading_session"}
              onClick={beginCamera}
              type="button"
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
            className="flex-1"
            onClick={retryChallenge}
            type="button"
            variant={challengeState === "all_passed" ? "outline" : "default"}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {challengeState === "all_passed" ? "Retake" : "Try Again"}
          </Button>
        )}

        {isStreaming &&
          challengeState !== "all_passed" &&
          challengeState !== "failed" &&
          challengeState !== "timeout" && (
            <div className="flex-1 text-center text-muted-foreground text-sm">
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
        disableNext={
          challengeState === "validating" ||
          challengeState === "failed" ||
          challengeState === "timeout" ||
          challengeState === "loading_session" ||
          (isStreaming && challengeState !== "all_passed")
        }
        onNext={handleSubmit}
        onSkip={handleSkipChallenges}
        showSkip
        skipLabel="Skip challenges"
      />
    </div>
  );
}
