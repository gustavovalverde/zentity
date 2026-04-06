"use client";

import { ModeToggle } from "@/components/mode-toggle";
import { PrivacyToggle } from "@/components/privacy-toggle";

/**
 * Client component for dashboard header actions.
 * Includes PrivacyToggle, ModeToggle, and UserButton from Better Auth UI.
 */
export function HeaderActions() {
  return (
    <div className="ml-auto flex items-center gap-2">
      <PrivacyToggle />
      <ModeToggle />
    </div>
  );
}
