"use client";

import { ModeToggle } from "@/components/mode-toggle";

/**
 * Client component for dashboard header actions.
 * Includes ModeToggle and UserButton from Better Auth UI.
 */
export function HeaderActions() {
  return (
    <div className="ml-auto flex items-center gap-2">
      <ModeToggle />
    </div>
  );
}
