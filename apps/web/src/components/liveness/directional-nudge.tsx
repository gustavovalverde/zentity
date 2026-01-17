"use client";

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
} from "lucide-react";

import { cn } from "@/lib/utils/utils";

export type NudgeDirection = "left" | "right" | "up" | "down" | null;

interface DirectionalNudgeProps {
  /** Direction to nudge the user */
  readonly direction: NudgeDirection;
  /** Optional className for container */
  readonly className?: string;
}

const ARROW_ICONS = {
  left: ArrowLeftIcon,
  right: ArrowRightIcon,
  up: ArrowUpIcon,
  down: ArrowDownIcon,
} as const;

/**
 * Directional nudge arrows positioned OUTSIDE the video frame.
 * Provides visual guidance for turn_left/turn_right challenges
 * without overlaying content on the camera feed.
 */
export function DirectionalNudge({
  direction,
  className,
}: Readonly<DirectionalNudgeProps>) {
  if (!direction) {
    return null;
  }

  const Icon = ARROW_ICONS[direction];

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute flex items-center justify-center",
        // Position arrows OUTSIDE the video frame
        direction === "left" && "top-1/2 -left-14 -translate-y-1/2",
        direction === "right" && "top-1/2 -right-14 -translate-y-1/2",
        direction === "up" && "-top-14 left-1/2 -translate-x-1/2",
        direction === "down" && "-bottom-14 left-1/2 -translate-x-1/2",
        className
      )}
    >
      {/* Animated arrow with glow effect */}
      <div className="relative">
        {/* Glow background */}
        <div
          className={cn(
            "absolute inset-0 rounded-full blur-md",
            "animate-pulse bg-amber-500/50"
          )}
        />
        {/* Arrow icon */}
        <Icon
          className={cn(
            "relative size-10 text-amber-500",
            // Directional bounce animations
            direction === "left" && "animate-bounce-left",
            direction === "right" && "animate-bounce-right",
            direction === "up" && "animate-bounce",
            direction === "down" && "animate-bounce"
          )}
        />
      </div>
    </div>
  );
}

/**
 * Container wrapper that provides proper spacing for directional nudges.
 * Use this to wrap the video container when directional nudges are enabled.
 */
export function DirectionalNudgeContainer({
  children,
  showNudges = false,
  className,
}: Readonly<{
  children: React.ReactNode;
  showNudges?: boolean;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        "relative",
        // Add padding when nudges might appear to prevent layout shift
        showNudges && "mx-16",
        className
      )}
    >
      {children}
    </div>
  );
}
