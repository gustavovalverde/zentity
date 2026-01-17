/**
 * Liveness Flow Component
 *
 * Main orchestrator for liveness verification.
 *
 * CRITICAL: The component tree structure must remain IDENTICAL regardless of
 * isFullscreen state. Changing the tree structure causes React to remount
 * CameraView, which detaches the camera stream from the video element.
 *
 * We use CSS-only transitions between desktop and fullscreen modes.
 */
"use client";

import { Camera, RotateCcw, XIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMobileDetect } from "@/hooks/use-device-detection";
import { cn } from "@/lib/utils/classname";

import { CameraView } from "./camera-view";
import { useLiveness } from "./liveness-provider";
import { ScreenReaderAnnouncer } from "./screen-reader-announcer";
import { SuccessAnimation } from "./success-animation";

export function LivenessFlow() {
  const {
    phase,
    error,
    isCompleted,
    isFailed,
    retryCount,
    start,
    retry,
    cancel,
    isStreaming,
  } = useLiveness();

  const { isMobile, isLandscape } = useMobileDetect();

  // Landscape warning on mobile
  useEffect(() => {
    if (isMobile && isLandscape && isStreaming) {
      toast.warning("Please rotate to portrait mode for best results");
    }
  }, [isMobile, isLandscape, isStreaming]);

  // State derivations
  const isIdle = !isStreaming && phase === "connecting";
  const isInitializing = isStreaming && phase === "connecting";
  const isActive = isStreaming && !isCompleted && !isFailed && !isInitializing;
  const isFullscreen = isMobile && isActive;

  // Screen reader message
  const getScreenReaderMessage = (): string | null => {
    switch (phase) {
      case "detecting":
        return "Position your face in the oval";
      case "countdown":
        return "Hold still";
      case "verifying":
        return "Verifying";
      default:
        return null;
    }
  };

  const canRetry = error?.canRetry && retryCount < 3;

  // ALWAYS render the same component tree structure to prevent remounting
  // Use CSS to toggle between desktop and fullscreen modes
  return (
    <div
      className={cn(
        // Base styles (always applied)
        "relative",
        // Fullscreen mode: fixed overlay covering viewport
        isFullscreen && "fixed inset-0 z-50 bg-black",
        // Desktop mode: standard spacing
        !isFullscreen && "space-y-6"
      )}
    >
      {/* Close button - only in fullscreen */}
      {isFullscreen && (
        <button
          aria-label="Exit fullscreen and stop camera"
          className="absolute top-4 right-4 z-50 rounded-full bg-black/50 p-3 pt-safe pr-safe text-white transition-colors hover:bg-black/70"
          onClick={cancel}
          type="button"
        >
          <XIcon className="size-6" />
        </button>
      )}

      {/* Camera container - same structure in both modes */}
      <div
        className={cn(
          "relative overflow-hidden",
          isFullscreen
            ? "absolute inset-0" // Fullscreen: fill viewport
            : "mx-auto aspect-4/3 w-full max-w-xl rounded-lg bg-muted" // Desktop: centered box
        )}
      >
        {/* CameraView - NEVER remounted */}
        <CameraView isFullscreen={isFullscreen} />
        <ScreenReaderAnnouncer message={getScreenReaderMessage()} />

        {/* Overlay: Idle state - show start button */}
        {isIdle && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background">
            <div className="text-center">
              <h2 className="font-semibold text-xl">Liveness Verification</h2>
              <p className="mt-2 text-muted-foreground">
                We'll verify you're a real person using your camera
              </p>
            </div>
            <Button className="mt-6 gap-2" onClick={start} size="lg">
              <Camera className="size-5" />
              Start Camera
            </Button>
          </div>
        )}

        {/* Overlay: Initializing/connecting state */}
        {isInitializing && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80">
            <Spinner className="size-8" />
            <p className="mt-4 text-muted-foreground">Connecting...</p>
          </div>
        )}

        {/* Overlay: Failed state */}
        {isFailed && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background p-4">
            <Alert className="max-w-md" variant="destructive">
              <AlertDescription>
                {error?.message ?? "Verification failed"}
              </AlertDescription>
            </Alert>
            {error?.recovery && (
              <p className="text-muted-foreground text-sm">
                {error.recovery.message}
              </p>
            )}
            {canRetry ? (
              <Button className="gap-2" onClick={retry} variant="outline">
                <RotateCcw className="size-4" />
                Try Again
              </Button>
            ) : (
              <Button onClick={cancel} variant="outline">
                Close
              </Button>
            )}
          </div>
        )}

        {/* Overlay: Completed state */}
        {isCompleted && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background">
            <SuccessAnimation showConfetti={false} />
            <p className="font-medium text-green-600">Verification complete!</p>
            <p className="text-center text-muted-foreground text-sm">
              Click Continue to proceed
            </p>
          </div>
        )}
      </div>

      {/* Cancel button for desktop - only show when active or initializing */}
      {!isFullscreen && (isActive || isInitializing) && (
        <div className="flex justify-center">
          <Button className="gap-2" onClick={cancel} size="sm" variant="ghost">
            <XIcon className="size-4" />
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
