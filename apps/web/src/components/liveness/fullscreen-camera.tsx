"use client";

import type { ReactNode } from "react";

import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils/utils";

interface FullscreenCameraProps {
  /** Whether to show in fullscreen mode */
  isFullscreen: boolean;
  /** Called when user closes fullscreen */
  onClose: () => void;
  /** Camera and overlay content */
  children: ReactNode;
  /** Additional class names for the fullscreen container */
  className?: string;
}

/**
 * Fullscreen wrapper for the liveness camera on mobile devices.
 * When not fullscreen, renders children directly.
 * When fullscreen, renders a fixed overlay with close button.
 */
export function FullscreenCamera({
  isFullscreen,
  onClose,
  children,
  className,
}: FullscreenCameraProps) {
  if (!isFullscreen) {
    return <>{children}</>;
  }

  return (
    <div className={cn("fixed inset-0 z-50 flex flex-col bg-black", className)}>
      {/* Close button - top right */}
      <button
        aria-label="Exit fullscreen and stop camera"
        className="absolute top-4 right-4 z-50 rounded-full bg-black/50 p-3 text-white transition-colors hover:bg-black/70"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-6" />
      </button>

      {/* Camera content - centered */}
      <div className="flex flex-1 flex-col items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
}
