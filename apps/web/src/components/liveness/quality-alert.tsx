"use client";

import type { LucideIcon } from "lucide-react";

import {
  AlertTriangleIcon,
  SunIcon,
  TargetIcon,
  UsersIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { cn } from "@/lib/utils/utils";

export type QualityIssue =
  | "low_light"
  | "multiple_faces"
  | "face_too_close"
  | "face_too_far"
  | "face_not_centered"
  | "face_occluded"
  | null;

interface QualityAlertConfig {
  icon: LucideIcon;
  message: string;
  ariaLabel: string;
}

const ALERT_CONFIG: Record<Exclude<QualityIssue, null>, QualityAlertConfig> = {
  low_light: {
    icon: SunIcon,
    message: "Move to a brighter area",
    ariaLabel: "Low light warning: move to a brighter area",
  },
  multiple_faces: {
    icon: UsersIcon,
    message: "Only one face should be visible",
    ariaLabel: "Multiple faces detected: only one face should be visible",
  },
  face_too_close: {
    icon: ZoomOutIcon,
    message: "Move back from the camera",
    ariaLabel: "Face too close: move back from the camera",
  },
  face_too_far: {
    icon: ZoomInIcon,
    message: "Move closer to the camera",
    ariaLabel: "Face too far: move closer to the camera",
  },
  face_not_centered: {
    icon: TargetIcon,
    message: "Center your face in the frame",
    ariaLabel: "Face not centered: center your face in the frame",
  },
  face_occluded: {
    icon: AlertTriangleIcon,
    message: "Remove any obstructions from your face",
    ariaLabel: "Face occluded: remove any obstructions from your face",
  },
};

interface QualityAlertProps {
  /** Current quality issue to display, or null for no alert */
  readonly issue: QualityIssue;
  /** Optional className for styling */
  readonly className?: string;
}

/**
 * Quality alert banner for liveness detection.
 * Displays warnings for conditions that may affect verification quality:
 * - Low light
 * - Multiple faces
 * - Face too close/far
 * - Face not centered
 * - Face occluded
 */
export function QualityAlert({
  issue,
  className,
}: Readonly<QualityAlertProps>) {
  if (!issue) {
    return null;
  }

  const config = ALERT_CONFIG[issue];
  const Icon = config.icon;

  return (
    <output
      aria-label={config.ariaLabel}
      aria-live="polite"
      className={cn(
        "absolute top-4 left-1/2 z-10 -translate-x-1/2",
        "flex items-center gap-2 rounded-lg px-4 py-2",
        "bg-amber-500/90 text-white backdrop-blur-sm",
        "fade-in slide-in-from-top-2 animate-in duration-200",
        className
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      <span className="font-medium text-sm">{config.message}</span>
    </output>
  );
}

/**
 * Derive quality issue from face metrics.
 * Used to compute the current quality issue from server-provided metrics.
 */
export function deriveQualityIssue(metrics: {
  faceCount?: number;
  faceSizeRatio?: number;
  centerOffsetRatio?: number;
  brightness?: number;
  isOccluded?: boolean;
}): QualityIssue {
  const {
    faceCount = 1,
    faceSizeRatio = 0.2,
    centerOffsetRatio = 0,
    brightness = 128,
    isOccluded = false,
  } = metrics;

  // Priority order: most important issues first
  if (faceCount > 1) {
    return "multiple_faces";
  }

  if (isOccluded) {
    return "face_occluded";
  }

  if (brightness < 50) {
    return "low_light";
  }

  if (faceSizeRatio > 0.5) {
    return "face_too_close";
  }

  if (faceSizeRatio < 0.08) {
    return "face_too_far";
  }

  if (centerOffsetRatio > 0.3) {
    return "face_not_centered";
  }

  return null;
}
