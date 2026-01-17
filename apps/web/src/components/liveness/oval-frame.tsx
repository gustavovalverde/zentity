"use client";

import { cn } from "@/lib/utils/classname";

export type OvalFrameStatus =
  | "searching"
  | "detected"
  | "challenging"
  | "success"
  | "error";

interface OvalFrameProps {
  /** Current status determining frame color */
  status: OvalFrameStatus;
  /** Challenge progress 0-100 (transitions oval color from amber to green) */
  progress?: number;
  /** Optional class name for the container */
  className?: string;
  /** Whether to show the darkened mask outside the oval */
  showMask?: boolean;
  /** Whether this is a mobile device (adjusts oval sizing) */
  isMobile?: boolean;
}

/**
 * Interpolate between two hex colors based on progress (0-1)
 */
function interpolateColor(
  color1: string,
  color2: string,
  progress: number
): string {
  const hex1 = color1.replace("#", "");
  const hex2 = color2.replace("#", "");

  const r1 = Number.parseInt(hex1.substring(0, 2), 16);
  const g1 = Number.parseInt(hex1.substring(2, 4), 16);
  const b1 = Number.parseInt(hex1.substring(4, 6), 16);

  const r2 = Number.parseInt(hex2.substring(0, 2), 16);
  const g2 = Number.parseInt(hex2.substring(2, 4), 16);
  const b2 = Number.parseInt(hex2.substring(4, 6), 16);

  const r = Math.round(r1 + (r2 - r1) * progress);
  const g = Math.round(g1 + (g2 - g1) * progress);
  const b = Math.round(b1 + (b2 - b1) * progress);

  return `rgb(${r}, ${g}, ${b})`;
}

// Colors
const COLORS = {
  slate: "#64748b", // searching
  amber: "#f59e0b", // challenge start (0%)
  green: "#22c55e", // detected / success / challenge complete (100%)
  red: "#ef4444", // error
};

/**
 * Single oval frame for face positioning guidance.
 * ONE element only - color indicates status and progress:
 * - Gray dashed: searching for face
 * - Green solid: face detected
 * - Amber → Green: challenge in progress (color transitions with progress)
 * - Red: error
 */
export function OvalFrame({
  status,
  progress = 0,
  className,
  showMask = true,
  isMobile = false,
}: Readonly<OvalFrameProps>) {
  // SVG viewBox dimensions - taller on mobile for better face positioning
  const viewBox = isMobile ? "0 0 100 140" : "0 0 100 120";
  const viewBoxHeight = isMobile ? 140 : 120;

  // Oval parameters - larger on mobile for easier face positioning
  const cx = 50;
  const cy = isMobile ? 60 : 52;
  const rx = isMobile ? 40 : 34;
  const ry = isMobile ? 52 : 44;

  // Determine oval appearance based on status
  let strokeColor: string;
  let strokeDasharray = "none";
  let shouldPulse = false;

  switch (status) {
    case "searching":
      strokeColor = COLORS.slate;
      strokeDasharray = "8 4"; // Dashed to indicate "looking"
      shouldPulse = true;
      break;
    case "detected":
      strokeColor = COLORS.green;
      break;
    case "challenging":
      // Color transitions from amber → green based on progress
      strokeColor = interpolateColor(
        COLORS.amber,
        COLORS.green,
        progress / 100
      );
      break;
    case "success":
      strokeColor = COLORS.green;
      break;
    case "error":
      strokeColor = COLORS.red;
      shouldPulse = true;
      break;
    default:
      strokeColor = COLORS.slate;
  }

  return (
    <svg
      aria-label="Face positioning guide"
      className={cn(
        "pointer-events-none absolute inset-0 size-full",
        className
      )}
      preserveAspectRatio={isMobile ? "xMidYMid slice" : "xMidYMid meet"}
      role="img"
      viewBox={viewBox}
    >
      {/* Light mask outside oval */}
      {showMask && (
        <>
          <defs>
            <mask id="oval-mask">
              <rect fill="white" height={viewBoxHeight} width="100" />
              <ellipse cx={cx} cy={cy} fill="black" rx={rx} ry={ry} />
            </mask>
          </defs>
          <rect
            fill="rgba(0,0,0,0.35)"
            height={viewBoxHeight}
            mask="url(#oval-mask)"
            width="100"
          />
        </>
      )}

      {/* Single oval - color indicates status and progress */}
      <ellipse
        className={cn(
          "transition-colors duration-200",
          shouldPulse && "animate-pulse"
        )}
        cx={cx}
        cy={cy}
        fill="none"
        rx={rx}
        ry={ry}
        stroke={strokeColor}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  );
}
