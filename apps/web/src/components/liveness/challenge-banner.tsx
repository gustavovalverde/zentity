"use client";

import { ArrowLeftIcon, ArrowRightIcon, SmileIcon } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils/utils";

export type ChallengeType = "smile" | "turn_left" | "turn_right";

interface ChallengeBannerProps {
  /** The type of challenge being performed */
  challenge: ChallengeType;
  /** Current challenge index (1-based) */
  currentIndex?: number;
  /** Total number of challenges */
  totalChallenges?: number;
  /** Optional hint text to display */
  hint?: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Optional class name */
  className?: string;
}

/**
 * Challenge configuration with icons and instructions
 */
const CHALLENGE_CONFIG: Record<
  ChallengeType,
  {
    Icon: typeof SmileIcon;
    instruction: string;
  }
> = {
  smile: {
    Icon: SmileIcon,
    instruction: "Smile!",
  },
  turn_left: {
    Icon: ArrowLeftIcon,
    instruction: "Turn left",
  },
  turn_right: {
    Icon: ArrowRightIcon,
    instruction: "Turn right",
  },
};

/**
 * Lightweight challenge hint shown below the video.
 * Displays the current challenge instruction with icon and progress.
 */
export function ChallengeBanner({
  challenge,
  currentIndex,
  totalChallenges,
  hint,
  progress,
  className,
}: ChallengeBannerProps) {
  const config = CHALLENGE_CONFIG[challenge];
  const Icon = config.Icon;

  return (
    <output
      aria-atomic="true"
      aria-live="polite"
      className={cn("flex flex-col items-center gap-2 text-center", className)}
    >
      {/* Icon and instruction - primary focus */}
      <div className="flex items-center justify-center gap-2 text-foreground">
        <Icon className="size-5 text-muted-foreground" />
        <span className="font-medium text-lg">{config.instruction}</span>
        {currentIndex !== undefined && totalChallenges !== undefined && (
          <span className="text-muted-foreground text-sm">
            ({currentIndex}/{totalChallenges})
          </span>
        )}
      </div>

      {/* Dynamic hint - secondary */}
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}

      {/* Progress bar - horizontal layout */}
      <div className="flex w-full max-w-xs items-center gap-3">
        <Progress
          className="h-2 flex-1 bg-muted"
          indicatorClassName={cn(
            "transition-all duration-150",
            progress >= 100 ? "bg-green-500" : "bg-primary"
          )}
          value={progress}
        />
        <span className="w-10 text-muted-foreground text-xs tabular-nums">
          {progress}%
        </span>
      </div>
    </output>
  );
}

interface CountdownOverlayProps {
  /** Countdown value (3, 2, 1) */
  count: number;
  /** Optional class name */
  className?: string;
}

/**
 * Full-screen countdown overlay shown before capturing baseline.
 */
export function CountdownOverlay({ count, className }: CountdownOverlayProps) {
  return (
    <div
      aria-atomic="true"
      aria-live="assertive"
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center",
        "bg-black/60 backdrop-blur-sm",
        className
      )}
      role="timer"
    >
      <span className="zoom-in animate-in font-bold text-8xl text-white duration-200">
        {count}
      </span>
      <p className="mt-4 text-lg text-white/70">Hold still...</p>
    </div>
  );
}

interface StatusBadgeProps {
  /** Status message to display */
  message: string;
  /** Optional icon component */
  icon?: React.ReactNode;
  /** Visual variant */
  variant?: "default" | "warning" | "success" | "error";
  /** Optional class name */
  className?: string;
}

/**
 * Small status badge for quick feedback messages.
 */
export function StatusBadge({
  message,
  icon,
  variant = "default",
  className,
}: StatusBadgeProps) {
  const variantStyles = {
    default: "bg-black/70 text-white",
    warning: "bg-amber-500/90 text-white",
    success: "bg-green-500/90 text-white",
    error: "bg-red-500/90 text-white",
  };

  return (
    <output
      aria-atomic="true"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-2",
        "font-medium text-sm shadow-lg backdrop-blur-sm",
        variantStyles[variant],
        className
      )}
    >
      {icon}
      <span>{message}</span>
    </output>
  );
}
