"use client";

import { ArrowLeftIcon, ArrowRightIcon, SmileIcon } from "lucide-react";

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
 * Lightweight challenge instruction shown over the video.
 * Uses high-contrast styling for visibility over any video background.
 * Progress is shown via the oval frame ring, not here.
 */
export function ChallengeBanner({
  challenge,
  currentIndex,
  totalChallenges,
  hint,
  className,
}: Readonly<ChallengeBannerProps>) {
  const config = CHALLENGE_CONFIG[challenge];
  const Icon = config.Icon;

  return (
    <output
      aria-atomic="true"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-2 text-center",
        "rounded-xl bg-black/70 px-5 py-3 backdrop-blur-sm",
        className
      )}
    >
      {/* Icon and instruction - primary focus */}
      <div className="flex items-center justify-center gap-2 text-white">
        <Icon className="size-6 text-white/80" />
        <span className="font-semibold text-xl">{config.instruction}</span>
        {currentIndex !== undefined && totalChallenges !== undefined && (
          <span className="text-sm text-white/70">
            ({currentIndex}/{totalChallenges})
          </span>
        )}
      </div>

      {/* Dynamic hint - secondary */}
      {hint && <p className="text-sm text-white/70">{hint}</p>}
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
export function CountdownOverlay({
  count,
  className,
}: Readonly<CountdownOverlayProps>) {
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
}: Readonly<StatusBadgeProps>) {
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
