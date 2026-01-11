"use client";

import { cn } from "@/lib/utils/utils";

export type OvalFrameStatus =
  | "searching"
  | "detected"
  | "challenging"
  | "success"
  | "error";

interface OvalFrameProps {
  /** Current status determining frame color and animation */
  status: OvalFrameStatus;
  /** Challenge progress 0-100 (shows progress ring when > 0) */
  progress?: number;
  /** Optional class name for the container */
  className?: string;
  /** Whether to show the darkened mask outside the oval */
  showMask?: boolean;
}

/**
 * Status-based styling configuration
 */
const STATUS_CONFIG: Record<
  OvalFrameStatus,
  {
    stroke: string;
    strokeDasharray: string;
    animate: boolean;
  }
> = {
  searching: {
    stroke: "#64748b", // slate-500
    strokeDasharray: "10 5",
    animate: true,
  },
  detected: {
    stroke: "#22c55e", // green-500
    strokeDasharray: "none",
    animate: false,
  },
  challenging: {
    stroke: "#f59e0b", // amber-500
    strokeDasharray: "none",
    animate: true,
  },
  success: {
    stroke: "#22c55e", // green-500
    strokeDasharray: "none",
    animate: false,
  },
  error: {
    stroke: "#ef4444", // red-500
    strokeDasharray: "none",
    animate: true,
  },
};

/**
 * Color-coded oval frame for face positioning guidance.
 * Implements iProov-style visual feedback with:
 * - Color changes based on detection status
 * - Animated dashed border when searching
 * - Progress ring during challenges
 * - Darkened mask outside the oval
 */
export function OvalFrame({
  status,
  progress = 0,
  className,
  showMask = true,
}: OvalFrameProps) {
  const config = STATUS_CONFIG[status];

  // SVG viewBox dimensions
  const viewBox = "0 0 100 120";

  // Oval parameters (centered, slightly above middle for face positioning)
  const cx = 50;
  const cy = 52;
  const rx = 34;
  const ry = 44;

  // Progress ring (slightly larger than main oval)
  const progressRx = rx + 3;
  const progressRy = ry + 3;

  // Calculate progress ring circumference (approximate for ellipse)
  const circumference =
    Math.PI * 2 * Math.sqrt((progressRx ** 2 + progressRy ** 2) / 2);
  const progressOffset = circumference - (progress / 100) * circumference;

  return (
    <svg
      aria-label="Face positioning guide"
      className={cn("absolute inset-0 size-full", className)}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox={viewBox}
    >
      {/* Darkened mask outside oval */}
      {showMask && (
        <>
          <defs>
            <mask id="oval-mask">
              <rect fill="white" height="120" width="100" />
              <ellipse cx={cx} cy={cy} fill="black" rx={rx} ry={ry} />
            </mask>
          </defs>
          <rect
            fill="rgba(0,0,0,0.5)"
            height="120"
            mask="url(#oval-mask)"
            width="100"
          />
        </>
      )}

      {/* Main oval frame */}
      <ellipse
        className={cn(
          "transition-all duration-300",
          config.animate && "animate-pulse"
        )}
        cx={cx}
        cy={cy}
        fill="none"
        rx={rx}
        ry={ry}
        stroke={config.stroke}
        strokeDasharray={config.strokeDasharray}
        strokeWidth="0.8"
      />

      {/* Progress ring (only shown during challenges) */}
      {progress > 0 && (
        <ellipse
          className="transition-all duration-150"
          cx={cx}
          cy={cy}
          fill="none"
          rx={progressRx}
          ry={progressRy}
          stroke="#22c55e"
          strokeDasharray={circumference}
          strokeDashoffset={progressOffset}
          strokeLinecap="round"
          strokeWidth="2"
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: `${cx}px ${cy}px`,
          }}
        />
      )}

      {/* Corner guides for visual reference */}
      <g opacity="0.3" stroke={config.stroke} strokeWidth="0.5">
        {/* Top left */}
        <path
          d={`M ${cx - rx + 5} ${cy - ry} L ${cx - rx} ${cy - ry} L ${cx - rx} ${cy - ry + 5}`}
          fill="none"
        />
        {/* Top right */}
        <path
          d={`M ${cx + rx - 5} ${cy - ry} L ${cx + rx} ${cy - ry} L ${cx + rx} ${cy - ry + 5}`}
          fill="none"
        />
        {/* Bottom left */}
        <path
          d={`M ${cx - rx + 5} ${cy + ry} L ${cx - rx} ${cy + ry} L ${cx - rx} ${cy + ry - 5}`}
          fill="none"
        />
        {/* Bottom right */}
        <path
          d={`M ${cx + rx - 5} ${cy + ry} L ${cx + rx} ${cy + ry} L ${cx + rx} ${cy + ry - 5}`}
          fill="none"
        />
      </g>
    </svg>
  );
}
