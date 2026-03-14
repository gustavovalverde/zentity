/**
 * Camera View Component
 *
 * Composes video element with overlays (oval, countdown, quality alerts, etc.)
 */
"use client";

import { Spinner } from "@/components/ui/spinner";
import { useMobileDetect } from "@/hooks/use-device-detection";
import { cn } from "@/lib/utils/classname";

import { AudioToggle } from "./audio-toggle";
import { ChallengeBanner, CountdownOverlay } from "./challenge-banner";
import { DirectionalNudge } from "./directional-nudge";
import { useLiveness } from "./liveness-provider";
import { OvalFrame, type OvalFrameStatus } from "./oval-frame";
import { deriveQualityIssue, QualityAlert } from "./quality-alert";

interface CameraViewProps {
  readonly isFullscreen?: boolean;
}

/**
 * Derive oval frame status from phase and face detection
 */
function getOvalStatus(phase: string, faceDetected: boolean): OvalFrameStatus {
  switch (phase) {
    case "detecting":
      return faceDetected ? "detected" : "searching";
    case "countdown":
    case "baseline":
      return "detected";
    case "challenging":
    case "capturing":
      return "challenging";
    case "completed":
      return "success";
    case "failed":
      return "error";
    default:
      return "searching";
  }
}

export function CameraView({
  isFullscreen = false,
}: Readonly<CameraViewProps>) {
  const {
    phase,
    faceDetected,
    faceBox,
    countdown,
    challenge,
    videoRef,
    audioEnabled,
    toggleAudio,
    initAudio,
  } = useLiveness();

  const { isMobile } = useMobileDetect();

  // Derive states
  const showOval = [
    "detecting",
    "countdown",
    "baseline",
    "challenging",
    "capturing",
  ].includes(phase);

  const showCountdown = phase === "countdown" && countdown !== null;

  // Derive nudge direction from challenge type
  const getNudgeDirection = (): "left" | "right" | null => {
    if (challenge?.type === "turn_left") {
      return "left";
    }
    if (challenge?.type === "turn_right") {
      return "right";
    }
    return null;
  };
  const nudgeDirection = getNudgeDirection();

  const ovalStatus = getOvalStatus(phase, faceDetected);

  // Quality issue for alerts
  const qualityIssue =
    phase === "detecting" && faceBox
      ? deriveQualityIssue({
          faceSizeRatio: (faceBox.width * faceBox.height) / (640 * 480),
          centerOffsetRatio: Math.max(
            Math.abs(faceBox.x + faceBox.width / 2 - 320) / 640,
            Math.abs(faceBox.y + faceBox.height / 2 - 240) / 480
          ),
        })
      : "none";

  return (
    <div
      className={cn(
        "overflow-visible",
        isFullscreen
          ? "absolute inset-0 bg-black" // Fullscreen: fill parent absolutely (no relative)
          : "relative aspect-4/3 w-full" // Desktop: relative for positioning children
      )}
    >
      {/* Video element - fills container */}
      <video
        autoPlay
        className="absolute inset-0 z-0 h-full w-full -scale-x-100 transform object-cover"
        muted
        playsInline
        ref={videoRef}
      />

      {/* Audio toggle (top right) */}
      <AudioToggle
        audioEnabled={audioEnabled}
        className="absolute top-3 right-3 z-20"
        onToggle={() => {
          initAudio();
          toggleAudio();
        }}
      />

      {/* Quality alert (top banner) */}
      {phase === "detecting" && qualityIssue !== "none" && (
        <div className="absolute top-12 right-0 left-0 z-10 flex justify-center px-4">
          <QualityAlert issue={qualityIssue} />
        </div>
      )}

      {/* Directional nudge arrows (outside video frame) */}
      {phase === "challenging" && nudgeDirection && (
        <DirectionalNudge direction={nudgeDirection} />
      )}

      {/* Oval frame */}
      {showOval && (
        <OvalFrame
          isMobile={isMobile}
          progress={challenge?.progress ?? 0}
          status={ovalStatus}
        />
      )}

      {/* Countdown overlay */}
      {showCountdown && countdown !== null && (
        <CountdownOverlay count={countdown} />
      )}

      {/* Verifying spinner */}
      {phase === "verifying" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-3">
            <Spinner className="size-8 text-white" />
            <span className="text-sm text-white">Verifying...</span>
          </div>
        </div>
      )}

      {/* Challenge banner (bottom center) */}
      {phase === "challenging" && challenge && (
        <div
          className={cn(
            "absolute right-0 bottom-0 left-0 z-10 flex justify-center",
            isFullscreen ? "p-4 pb-safe" : "p-3"
          )}
        >
          <ChallengeBanner
            challenge={challenge.type}
            hint={challenge.hint ?? undefined}
          />
        </div>
      )}
    </div>
  );
}
