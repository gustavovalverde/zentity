"use client";

import { CheckCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils/utils";

interface ConfettiParticle {
  id: number;
  x: number;
  color: string;
  delay: number;
  size: number;
}

interface SuccessAnimationProps {
  /** Optional class name */
  className?: string;
  /** Whether to show confetti particles */
  showConfetti?: boolean;
  /** Duration before auto-hiding (ms). Set to 0 to never hide. */
  autoHideDuration?: number;
  /** Callback when animation completes */
  onComplete?: () => void;
}

/**
 * Confetti colors using CSS custom properties for theme awareness.
 * These reference Tailwind's color palette via oklch values.
 */
const CONFETTI_COLORS = [
  "oklch(0.723 0.219 142.5)", // green-500 equivalent
  "oklch(0.623 0.214 259.1)", // blue-500 equivalent
  "oklch(0.769 0.188 70.1)", // amber-500 equivalent
  "oklch(0.656 0.241 354.3)", // pink-500 equivalent
  "oklch(0.606 0.25 292.7)", // violet-500 equivalent
];

/**
 * Generate random confetti particles
 */
function generateConfetti(count: number): ConfettiParticle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    delay: Math.random() * 0.3,
    size: 6 + Math.random() * 4,
  }));
}

/**
 * Success animation shown when liveness verification completes.
 * Simple, contained checkmark with optional confetti - NOT a full-page overlay.
 */
export function SuccessAnimation({
  className,
  showConfetti = true,
  autoHideDuration = 0,
  onComplete,
}: SuccessAnimationProps) {
  const [confetti] = useState(() => generateConfetti(12));
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (autoHideDuration > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        onComplete?.();
      }, autoHideDuration);
      return () => clearTimeout(timer);
    }
  }, [autoHideDuration, onComplete]);

  if (!visible) {
    return null;
  }

  return (
    <output
      aria-label="Verification successful"
      className={cn(
        "relative flex flex-col items-center justify-center",
        "fade-in animate-in duration-300",
        className
      )}
    >
      {/* Success icon */}
      <div className="zoom-in animate-in rounded-full bg-success p-5 shadow-lg duration-300">
        <CheckCircleIcon className="size-12 text-success-foreground" />
      </div>

      {/* Confetti particles - contained within component bounds */}
      {showConfetti && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {confetti.map((particle) => (
            <div
              className="absolute animate-confetti-fall"
              key={particle.id}
              style={
                {
                  left: `${particle.x}%`,
                  animationDelay: `${particle.delay}s`,
                  "--confetti-color": particle.color,
                } as React.CSSProperties
              }
            >
              <div
                className="animate-confetti-spin rounded-full"
                style={{
                  width: particle.size,
                  height: particle.size,
                  backgroundColor: particle.color,
                }}
              />
            </div>
          ))}
        </div>
      )}
    </output>
  );
}

interface ChallengeSuccessFlashProps {
  /** Optional class name */
  className?: string;
  /** Duration of the flash (ms) */
  duration?: number;
  /** Callback when flash completes */
  onComplete?: () => void;
}

/**
 * Brief green flash shown when a single challenge passes.
 * Less prominent than the full success animation.
 */
export function ChallengeSuccessFlash({
  className,
  duration = 400,
  onComplete,
}: ChallengeSuccessFlashProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0",
        "fade-out animate-out bg-success/20 duration-300",
        className
      )}
    />
  );
}
