"use client";

/* eslint @next/next/no-img-element: off */

import { Camera, CameraOff, CheckCircle2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AudioToggle,
  ChallengeBanner,
  CountdownOverlay,
  DirectionalNudge,
  deriveQualityIssue,
  FullscreenCamera,
  type NudgeDirection,
  OvalFrame,
  type OvalFrameStatus,
  QualityAlert,
  type QualityIssue,
  ScreenReaderAnnouncer,
  SuccessAnimation,
} from "@/components/liveness";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { type LivenessPhase, useLiveness } from "@/hooks/liveness/use-liveness";
import { useLivenessFeedback } from "@/hooks/liveness/use-liveness-feedback";
import { useLivenessCamera } from "@/hooks/use-liveness-camera";
import { useMobileDetect } from "@/hooks/use-mobile-detect";
import {
  detectLanguage,
  getScreenReaderText,
  type ScreenReaderKey,
} from "@/lib/liveness/speech/texts";
import { trpc } from "@/lib/trpc/client";

import { useOnboardingStore } from "./onboarding-store";
import { useStepper } from "./stepper-context";
import { StepperControls } from "./stepper-ui";

const debugEnabled = process.env.NEXT_PUBLIC_DEBUG === "1";

/**
 * Map liveness phase to oval frame status for visual feedback
 */
function getOvalFrameStatus(
  phase: LivenessPhase,
  faceDetected: boolean
): OvalFrameStatus {
  switch (phase) {
    case "detecting":
      return faceDetected ? "detected" : "searching";
    case "countdown":
    case "baseline":
      return "detected";
    case "challenging":
      return "challenging";
    case "completed":
      return "success";
    case "failed":
      return "error";
    default:
      return "searching";
  }
}

export function StepLiveness() {
  const stepper = useStepper();
  const store = useOnboardingStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [localCountdown, setLocalCountdown] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [srMessage, setSrMessage] = useState<string | null>(null);
  const countdownRunIdRef = useRef(0);

  // Mobile detection for fullscreen mode
  const { isMobile, isLandscape } = useMobileDetect();

  // Track previous states for feedback triggers
  const prevPhaseRef = useRef<LivenessPhase>("connecting");
  const prevFaceDetectedRef = useRef(false);
  const prevChallengeIndexRef = useRef<number | null>(null);
  const prevProgressRef = useRef(0);
  const lastSpokenChallengeRef = useRef<string | null>(null);
  const challengeAnnounceIdRef = useRef(0);

  // Feedback controller
  const {
    feedback,
    playEarcon,
    speak,
    triggerHaptic,
    audioEnabled,
    speechEnabled,
    speechSupported,
    setAudioEnabled,
    setSpeechEnabled,
    initAudio,
    initSpeech,
  } = useLivenessFeedback();

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

  const handleExitFullscreen = useCallback(() => {
    setIsFullscreen(false);
    stopCamera();
  }, [stopCamera]);

  const {
    phase,
    challenge,
    face,
    hint,
    isConnected,
    selfieImage: serverSelfieImage,
    errorMessage,
    error,
    isRetrying,
    beginCamera,
    signalCountdownDone,
    signalChallengeReady,
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
  const isCompleted = phase === "completed";
  const isFailed = phase === "failed";
  const isIdle = phase === "connecting" && !isConnected;

  // Oval frame status for visual feedback
  const ovalFrameStatus = getOvalFrameStatus(phase, face.detected);

  // Compute quality metrics from face box (client-side)
  const qualityIssue: QualityIssue = (() => {
    if (!(face.detected && face.box)) {
      return null;
    }
    // Video dimensions (use standard capture dimensions as reference)
    const frameWidth = 640;
    const frameHeight = 480;
    const faceArea = face.box.width * face.box.height;
    const frameArea = frameWidth * frameHeight;
    const faceSizeRatio = faceArea / frameArea;

    // Center offset (0-1, where 0 = perfectly centered)
    const faceCenterX = face.box.x + face.box.width / 2;
    const faceCenterY = face.box.y + face.box.height / 2;
    const frameCenterX = frameWidth / 2;
    const frameCenterY = frameHeight / 2;
    const offsetX = Math.abs(faceCenterX - frameCenterX) / frameWidth;
    const offsetY = Math.abs(faceCenterY - frameCenterY) / frameHeight;
    const centerOffsetRatio = Math.max(offsetX, offsetY);

    return deriveQualityIssue({ faceSizeRatio, centerOffsetRatio });
  })();

  // Determine nudge direction for turn challenges
  const nudgeDirection: NudgeDirection = (() => {
    if (phase !== "challenging" || !challenge) {
      return null;
    }
    if (challenge.type === "turn_left") {
      return "left";
    }
    if (challenge.type === "turn_right") {
      return "right";
    }
    return null;
  })();

  const playCountdownCue = useCallback(
    (value: number) => {
      if (value === 3) {
        playEarcon("countdown3");
        triggerHaptic("countdown3");
      } else if (value === 2) {
        playEarcon("countdown2");
        triggerHaptic("countdown2");
      } else if (value === 1) {
        playEarcon("countdown1");
        triggerHaptic("countdown1");
      }
    },
    [playEarcon, triggerHaptic]
  );

  // ===== FEEDBACK EFFECTS =====

  // Face detected/lost feedback
  useEffect(() => {
    if (face.detected !== prevFaceDetectedRef.current) {
      if (face.detected) {
        feedback("faceDetected");
      } else if (prevFaceDetectedRef.current && phase === "detecting") {
        // Only trigger face lost after a short delay and if still in detecting phase
        const timer = setTimeout(() => {
          feedback("faceLost");
          speak("faceLost");
        }, 1500);
        return () => clearTimeout(timer);
      }
      prevFaceDetectedRef.current = face.detected;
    }
  }, [face.detected, phase, feedback, speak]);

  // Phase transition feedback
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;

    // Speak instruction when phase starts (each cancels previous)
    if (phase !== prevPhase) {
      if (phase === "detecting" && prevPhase === "connecting") {
        if (!face.detected) {
          speak("positionFace");
        }
      } else if (phase === "verifying") {
        speak("verifying", "high");
      } else if (phase === "completed") {
        setShowSuccessAnimation(true);
        feedback("verificationComplete");
        speak("verificationComplete", "high");
      } else if (phase === "failed") {
        feedback("error");
        speak("tryAgain", "high");
      }

      prevPhaseRef.current = phase;
    }
  }, [phase, face.detected, feedback, speak]);

  // Screen reader announcements for phase changes
  useEffect(() => {
    const lang = detectLanguage();

    // Announce retry in progress
    if (isRetrying) {
      setSrMessage(getScreenReaderText("sr_retry_in_progress", lang));
      return;
    }

    const phaseToSrKey: Partial<Record<LivenessPhase, ScreenReaderKey>> = {
      connecting: "sr_connecting",
      countdown: "sr_countdown_starting",
      completed: "sr_verification_success",
      failed: "sr_verification_failed",
    };

    const srKey = phaseToSrKey[phase];
    if (srKey) {
      setSrMessage(getScreenReaderText(srKey, lang));
    }

    // Announce when face is first detected during detecting phase
    if (phase === "detecting" && face.detected) {
      setSrMessage(getScreenReaderText("sr_face_detected", lang));
    }
  }, [phase, face.detected, isRetrying]);

  // Screen reader announcements for challenge changes
  const challengeType = challenge?.type;
  const challengeIndex = challenge?.index;
  const challengeProgress = challenge?.progress;
  useEffect(() => {
    if (!(challengeType !== undefined && challengeIndex !== undefined)) {
      return;
    }

    const lang = detectLanguage();
    const challengeToSrKey: Record<string, ScreenReaderKey> = {
      smile: "sr_challenge_smile",
      turn_left: "sr_challenge_turn_left",
      turn_right: "sr_challenge_turn_right",
    };

    const srKey = challengeToSrKey[challengeType];
    if (srKey) {
      setSrMessage(getScreenReaderText(srKey, lang));
    }

    // Announce progress milestones
    if (
      challengeProgress !== undefined &&
      challengeProgress >= 50 &&
      challengeProgress < 100
    ) {
      setSrMessage(getScreenReaderText("sr_progress_50", lang));
    }
  }, [challengeType, challengeIndex, challengeProgress]);

  // Client-owned countdown timeline (keeps audio + visuals in sync)
  useEffect(() => {
    if (phase !== "countdown") {
      setLocalCountdown(null);
      return;
    }

    let cancelled = false;
    const runId = ++countdownRunIdRef.current;
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const run = async () => {
      if (speechEnabled && speechSupported) {
        await speak("holdStill");
        if (cancelled || countdownRunIdRef.current !== runId) {
          return;
        }
      }

      for (const value of [3, 2, 1]) {
        setLocalCountdown(value);
        playCountdownCue(value);
        await sleep(1000);
        if (cancelled || countdownRunIdRef.current !== runId) {
          return;
        }
      }

      setLocalCountdown(null);
      signalCountdownDone();
    };

    run().catch(() => {
      // Fire-and-forget: errors handled internally
    });
    return () => {
      cancelled = true;
      setLocalCountdown(null);
    };
  }, [
    phase,
    speechEnabled,
    speechSupported,
    speak,
    playCountdownCue,
    signalCountdownDone,
  ]);

  // Challenge feedback
  useEffect(() => {
    if (!challenge) {
      prevChallengeIndexRef.current = null;
      prevProgressRef.current = 0;
      lastSpokenChallengeRef.current = null;
      challengeAnnounceIdRef.current += 1;
      return;
    }

    // New challenge started - speak instruction (with deduplication guard)
    const challengeKey = `${challenge.index}-${challenge.type}`;
    if (
      challenge.index !== prevChallengeIndexRef.current ||
      challengeKey !== lastSpokenChallengeRef.current
    ) {
      // Only announce if we haven't spoken this exact challenge
      if (challengeKey !== lastSpokenChallengeRef.current) {
        const runId = ++challengeAnnounceIdRef.current;
        lastSpokenChallengeRef.current = challengeKey;

        const run = async () => {
          if (speechEnabled && speechSupported) {
            if (challenge.type === "smile") {
              await speak("smile");
            } else if (challenge.type === "turn_left") {
              await speak("turnLeft");
            } else if (challenge.type === "turn_right") {
              await speak("turnRight");
            }
          }
          if (challengeAnnounceIdRef.current !== runId) {
            return;
          }
          signalChallengeReady();
        };

        run().catch(() => {
          // Fire-and-forget: errors handled internally
        });
      }
      prevChallengeIndexRef.current = challenge.index;
      prevProgressRef.current = 0;
    }

    // Progress milestone feedback (every 50%) with spatial audio for turn challenges
    const progressMilestone = Math.floor(challenge.progress / 50) * 50;
    const prevMilestone = Math.floor(prevProgressRef.current / 50) * 50;
    if (progressMilestone > prevMilestone && progressMilestone < 100) {
      // Use spatial panning for turn challenges
      let pan = 0;
      if (challenge.type === "turn_left") {
        pan = -0.8;
      } else if (challenge.type === "turn_right") {
        pan = 0.8;
      }
      feedback("challengeProgress", pan);
    }

    // Challenge completed
    if (challenge.progress >= 100 && prevProgressRef.current < 100) {
      feedback("challengePassed");
      speak("challengePassed");
    }

    prevProgressRef.current = challenge.progress;
  }, [
    challenge,
    feedback,
    speak,
    speechEnabled,
    speechSupported,
    signalChallengeReady,
  ]);

  // Hide success animation after delay
  useEffect(() => {
    if (showSuccessAnimation) {
      const timer = setTimeout(() => setShowSuccessAnimation(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [showSuccessAnimation]);

  // Auto-fullscreen on mobile when camera starts
  useEffect(() => {
    if (isMobile && isStreaming && !isCompleted && !isFailed) {
      setIsFullscreen(true);
    }
    if (isCompleted || isFailed) {
      setIsFullscreen(false);
    }
  }, [isMobile, isStreaming, isCompleted, isFailed]);

  // Warn about landscape mode on mobile
  useEffect(() => {
    if (isMobile && isLandscape && isStreaming) {
      toast.warning("Please rotate to portrait mode", {
        description: "Liveness detection works best in portrait orientation.",
      });
    }
  }, [isMobile, isLandscape, isStreaming]);

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

  const disableNext =
    phase === "verifying" || isFailed || (isStreaming && !isCompleted);

  return (
    <div className="space-y-6">
      {/* Screen reader announcements for accessibility */}
      <ScreenReaderAnnouncer message={srMessage} />

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

      {/* Camera/Image display - wrapped in FullscreenCamera for mobile */}
      <FullscreenCamera
        isFullscreen={isFullscreen}
        onClose={handleExitFullscreen}
      >
        <div className="relative mx-16 aspect-4/3 w-auto overflow-visible rounded-lg bg-muted">
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

          {/* Audio toggle button */}
          {isStreaming && (
            <div className="absolute top-3 right-3 z-20">
              <AudioToggle
                audioEnabled={audioEnabled || speechEnabled}
                className="bg-black/50 hover:bg-black/70"
                onToggle={() => {
                  const newState = !(audioEnabled || speechEnabled);
                  setAudioEnabled(newState);
                  setSpeechEnabled(newState);
                }}
              />
            </div>
          )}

          {/* Directional nudge arrows (outside video frame) */}
          {nudgeDirection && <DirectionalNudge direction={nudgeDirection} />}

          {/* Quality alert banner */}
          {phase === "detecting" && qualityIssue && (
            <QualityAlert issue={qualityIssue} />
          )}

          {/* Face positioning guide - iProov style */}
          {(phase === "detecting" ||
            phase === "challenging" ||
            phase === "countdown" ||
            phase === "baseline") && (
            <OvalFrame
              className="pointer-events-none"
              progress={challenge?.progress ?? 0}
              showMask
              status={ovalFrameStatus}
            />
          )}

          {/* Countdown overlay */}
          {phase === "countdown" && localCountdown !== null && (
            <CountdownOverlay count={localCountdown} />
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

          {/* Success animation */}
          {showSuccessAnimation && (
            <SuccessAnimation
              autoHideDuration={2500}
              onComplete={() => setShowSuccessAnimation(false)}
              showConfetti
            />
          )}
        </div>

        {/* Challenge instructions - below video for clarity */}
        {phase === "challenging" && challenge && (
          <div className="mt-3 flex justify-center">
            <ChallengeBanner
              challenge={challenge.type}
              currentIndex={challenge.index + 1}
              hint={challenge.hint ?? hint}
              progress={challenge.progress}
              totalChallenges={challenge.total}
            />
          </div>
        )}
      </FullscreenCamera>

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

      {/* Error indicator with recovery guidance */}
      {isFailed && (errorMessage || error) && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{errorMessage || error?.message}</p>
            {error?.recovery && (
              <p className="mt-1 text-xs opacity-80">
                {error.recovery.message}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {isIdle && !isStreaming && (
          <Button
            className="flex-1"
            onClick={() => {
              initAudio(); // Initialize Web Audio API on user interaction
              initSpeech(); // Initialize Web Speech API on user interaction (Chrome M71+)
              beginCamera();
            }}
            type="button"
          >
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
