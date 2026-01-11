"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils/utils";

interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Content to hide visually but keep accessible */
  children: ReactNode;
}

/**
 * VisuallyHidden component for screen reader only content.
 *
 * Hides content visually while keeping it accessible to screen readers.
 * Based on Radix UI pattern: https://www.radix-ui.com/primitives/docs/utilities/visually-hidden
 */
export function VisuallyHidden({
  children,
  className,
  ...props
}: VisuallyHiddenProps) {
  return (
    <span
      className={cn(
        // Hide visually
        "absolute h-px w-px overflow-hidden whitespace-nowrap",
        // Remove from flow
        "border-0 p-0",
        // Clip to nothing
        "[clip:rect(0,0,0,0)]",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
