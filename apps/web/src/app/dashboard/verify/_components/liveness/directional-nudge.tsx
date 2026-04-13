"use client";

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";

type NudgeDirection = "left" | "right" | "up" | "down" | null;

interface DirectionalNudgeProps {
  readonly className?: string;
  readonly direction: NudgeDirection;
}

const ARROW_ICONS = {
  left: ArrowLeftIcon,
  right: ArrowRightIcon,
  up: ArrowUpIcon,
  down: ArrowDownIcon,
} as const;

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
        "pointer-events-none absolute flex items-center justify-center rounded-full bg-black/40 p-2",
        direction === "left" && "top-1/2 left-2 -translate-y-1/2",
        direction === "right" && "top-1/2 right-2 -translate-y-1/2",
        direction === "up" && "top-2 left-1/2 -translate-x-1/2",
        direction === "down" && "bottom-2 left-1/2 -translate-x-1/2",
        className
      )}
    >
      <Icon
        className={cn(
          "size-8 text-warning",
          direction === "left" && "animate-bounce-left",
          direction === "right" && "animate-bounce-right",
          direction === "up" && "animate-bounce",
          direction === "down" && "animate-bounce"
        )}
      />
    </div>
  );
}
