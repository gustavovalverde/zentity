"use client";

/* eslint @next/next/no-img-element: off */

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  RotateCcw,
  Smile,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useLiveness } from "@/hooks/liveness/use-liveness";
import { useLivenessCamera } from "@/hooks/use-liveness-camera";
import { CHALLENGE_INSTRUCTIONS } from "@/lib/liveness/challenges";
import { trpc } from "@/lib/trpc/client";

import { useOnboardingStore } from "./onboarding-store";
import { useStepper } from "./stepper-context";
import { StepperControls } from "./stepper-ui";

const debugEnabled = process.env.NEXT_PUBLIC_DEBUG === "1";

export function StepLiveness() {
  const stepper = useStepper();
  const store = useOnboardingStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      store.set({ selfieImage, bestSelfieFrame, blinkCount });
    },
    [store]
  );

  const handleReset = useCallback(() => {
    store.set({
      selfieImage: null,
      bestSelfieFrame: null,
      blinkCount: null,
    });
  }, [store]);

  const handleSessionError = useCallback(() => {
    store.reset();
    stepper.goTo("email");
  }, [store, stepper]);

  const {
    phase,
    challenge,
    face,
    countdown,
    hint,
    isConnected,
    selfieImage: serverSelfieImage,
    errorMessage,
    beginCamera,
    retryChallenge,
  } = useLiveness({
    videoRef,
    isStreaming,
    startCamera,
    stopCamera,
    numChallenges: 2,
    debugEnabled,
    onVerified: handleVerified,
    onReset: handleReset,
    onSessionError: handleSessionError,
  });

  // Map server phase to display state
  const isActive = [
    "detecting",
    "countdown",
    "baseline",
    "challenging",
    "verifying",
  ].includes(phase);
  const isCompleted = phase === "completed";
  const isFailed = phase === "failed";
  const isIdle = phase === "connecting" && !isConnected;

  const handleSubmit = useCallback(async () => {
    stopCamera();

    const selfieToVerify =
      store.bestSelfieFrame || store.selfieImage || serverSelfieImage;
    if (!selfieToVerify) {
      toast.error("Missing selfie", {
        description: "Please complete the liveness step before continuing.",
      });
      return;
    }
    if (!(store.idDocumentBase64 && store.identityDraftId)) {
      toast.error("Missing document context", {
        description:
          "Please re-upload your ID so we can complete verification.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await trpc.identity.prepareLiveness.mutate({
        draftId: store.identityDraftId,
        documentImage: store.idDocumentBase64,
        selfieImage: selfieToVerify,
      });

      store.set({
        livenessPassed: response.livenessPassed,
        faceMatchPassed: response.faceMatchPassed,
      });

      stepper.next();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to prepare liveness verification.";
      toast.error("Verification failed", { description: message });
    } finally {
      setIsSubmitting(false);
    }
  }, [stepper, stopCamera, store, serverSelfieImage]);

  const handleSkipChallenges = useCallback(async () => {
    try {
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

      store.set({
        selfieImage: frame,
        bestSelfieFrame: frame,
        blinkCount: null,
      });
      stopCamera();

      if (!(store.idDocumentBase64 && store.identityDraftId)) {
        toast.error("Missing document context", {
          description:
            "Please re-upload your ID so we can complete verification.",
        });
        return;
      }

      setIsSubmitting(true);
      const response = await trpc.identity.prepareLiveness.mutate({
        draftId: store.identityDraftId,
        documentImage: store.idDocumentBase64,
        selfieImage: frame,
      });

      store.set({
        livenessPassed: response.livenessPassed,
        faceMatchPassed: response.faceMatchPassed,
      });

      stepper.goTo("account");
    } catch {
      toast.error("Camera unavailable", {
        description:
          "Please allow camera access to continue, or try again in a different browser.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [captureFrame, isStreaming, startCamera, stepper, stopCamera, store]);

  // Get challenge instruction text
  const challengeInstruction = challenge
    ? (CHALLENGE_INSTRUCTIONS[challenge.type]?.instruction ?? challenge.hint)
    : null;

  const disableNext =
    phase === "verifying" || isFailed || (isStreaming && !isCompleted);

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
      </div>

      {/* Camera/Image display */}
      <div className="relative aspect-4/3 w-full overflow-hidden rounded-lg bg-muted">
        {(isCompleted || isFailed) && serverSelfieImage ? (
          <img
            alt={isCompleted ? "Verified selfie" : "Failed selfie"}
            className={`h-full w-full object-cover ${isFailed ? "opacity-50" : ""}`}
            height={480}
            src={serverSelfieImage}
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
            {/* Debug overlay */}
            {debugEnabled && isStreaming && (
              <div className="absolute top-2 left-2 z-10 max-w-[95%] rounded-md bg-black/70 px-2 py-1 text-[10px] text-white leading-snug">
                <div className="font-mono">
                  <div>phase: {phase}</div>
                  <div>connected: {isConnected ? "yes" : "no"}</div>
                  <div>face: {face.detected ? "yes" : "no"}</div>
                  {challenge && (
                    <div>
                      challenge: {challenge.type} ({challenge.index + 1}/
                      {challenge.total}) - {challenge.progress}%
                    </div>
                  )}
                  {hint && <div>hint: {hint}</div>}
                </div>
              </div>
            )}
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

        {/* Face positioning guide */}
        {(phase === "detecting" || phase === "challenging") && (
          <div className="pointer-events-none absolute inset-0">
            <svg
              aria-label="Face positioning guide"
              className="h-full w-full"
              preserveAspectRatio="xMidYMid slice"
              role="img"
              viewBox="0 0 640 480"
            >
              <title>Face positioning guide</title>
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
              <ellipse
                className={phase === "detecting" ? "animate-pulse" : ""}
                cx="320"
                cy="200"
                fill="none"
                rx="130"
                ry="170"
                stroke={
                  phase === "challenging"
                    ? "var(--warning)"
                    : "var(--foreground)"
                }
                strokeDasharray={phase === "detecting" ? "12,6" : "none"}
                strokeWidth="3"
              />
              <g
                stroke={
                  phase === "challenging"
                    ? "var(--warning)"
                    : "var(--foreground)"
                }
                strokeLinecap="round"
                strokeWidth="3"
              >
                <path d="M 170 50 L 170 90 M 170 50 L 210 50" fill="none" />
                <path d="M 470 50 L 470 90 M 470 50 L 430 50" fill="none" />
                <path d="M 170 400 L 170 360 M 170 400 L 210 400" fill="none" />
                <path d="M 470 400 L 470 360 M 470 400 L 430 400" fill="none" />
              </g>
            </svg>
          </div>
        )}

        {/* Detecting face overlay */}
        {phase === "detecting" && (
          <div className="absolute right-0 bottom-4 left-0 flex justify-center">
            <output
              aria-atomic="true"
              aria-live="polite"
              className="block rounded-lg bg-background/90 px-4 py-3 shadow-lg backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <Spinner aria-hidden="true" className="size-5 text-primary" />
                <div>
                  <p className="font-medium">
                    {hint || "Position your face in the frame"}
                  </p>
                </div>
              </div>
            </output>
          </div>
        )}

        {/* Countdown overlay */}
        {phase === "countdown" && countdown !== null && (
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
                Hold still…
              </p>
            </div>
          </div>
        )}

        {/* Challenge overlay */}
        {phase === "challenging" && challenge && (
          <div className="absolute right-0 bottom-4 left-0 flex justify-center">
            <output
              aria-atomic="true"
              aria-live="polite"
              className="block rounded-lg bg-warning/90 px-6 py-4 shadow-lg backdrop-blur"
            >
              <div className="flex items-center gap-3 text-warning-foreground">
                {challenge.type === "smile" && (
                  <Smile aria-hidden="true" className="h-8 w-8" />
                )}
                {challenge.type === "turn_left" && (
                  <ArrowLeft aria-hidden="true" className="h-8 w-8" />
                )}
                {challenge.type === "turn_right" && (
                  <ArrowRight aria-hidden="true" className="h-8 w-8" />
                )}
                <div>
                  <p className="font-bold text-xl">
                    {challengeInstruction || hint || "Follow the prompt"}
                  </p>
                  <div className="mt-2">
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-xs">Progress:</span>
                      <Progress
                        aria-label={`Challenge progress: ${challenge.progress}%`}
                        className="h-2 w-32 bg-warning/20"
                        indicatorClassName="bg-warning"
                        value={challenge.progress}
                      />
                      <span className="w-8 text-xs">{challenge.progress}%</span>
                    </div>
                  </div>
                  {challenge.hint && (
                    <p className="mt-2 font-medium text-warning-foreground text-xs">
                      {challenge.hint}
                    </p>
                  )}
                  <p aria-hidden="true" className="mt-1 text-xs">
                    {challenge.index + 1} of {challenge.total}
                  </p>
                </div>
              </div>
            </output>
          </div>
        )}

        {/* Verifying overlay */}
        {phase === "verifying" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <output
              aria-live="polite"
              className="block rounded-lg bg-background/95 px-6 py-4 shadow-lg"
            >
              <div className="flex items-center gap-3">
                <Spinner aria-hidden="true" className="size-6 text-primary" />
                <p className="font-medium">Verifying your identity…</p>
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
      {isCompleted && (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="ml-2">
            Liveness verified! Click &quot;Next&quot; to continue.
          </AlertDescription>
        </Alert>
      )}

      {/* Error indicator */}
      {isFailed && errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {isIdle && !isStreaming && (
          <Button className="flex-1" onClick={beginCamera} type="button">
            <Camera className="mr-2 h-4 w-4" />
            Start Camera
          </Button>
        )}

        {phase === "connecting" && isConnected && (
          <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-4" />
            <span>Connecting...</span>
          </div>
        )}

        {(isCompleted || isFailed) && (
          <Button
            className="flex-1"
            onClick={retryChallenge}
            type="button"
            variant={isCompleted ? "outline" : "default"}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {isCompleted ? "Retake" : "Try Again"}
          </Button>
        )}

        {isActive && (
          <div className="flex-1 text-center text-muted-foreground text-sm">
            {phase === "detecting" && "Looking for your face…"}
            {phase === "countdown" && "Get ready…"}
            {phase === "baseline" && "Capturing baseline…"}
            {phase === "challenging" && challengeInstruction}
            {phase === "verifying" && "Verifying…"}
          </div>
        )}
      </div>

      <Alert>
        <AlertDescription>
          Your photos are processed securely and never stored. We verify
          you&apos;re a real person through randomized challenges.
        </AlertDescription>
      </Alert>

      <StepperControls
        disableNext={disableNext}
        isSubmitting={isSubmitting}
        onNext={handleSubmit}
        onSkip={handleSkipChallenges}
        showSkip
        skipLabel="Skip challenges"
        stepper={stepper}
      />
    </div>
  );
}
