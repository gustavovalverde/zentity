"use client";

import { SessionsCard as BetterAuthSessionsCard } from "@daveyplate/better-auth-ui";

/**
 * Active Sessions Card
 *
 * View and manage active sessions across devices.
 */
export function SessionsCard() {
  return (
    <BetterAuthSessionsCard
      localization={{
        SESSIONS: "Active Sessions",
        SESSIONS_DESCRIPTION:
          "View and manage your active sessions across devices. Revoke any session you don't recognize.",
        CURRENT_SESSION: "Current Session",
        REVOKE: "Revoke",
      }}
    />
  );
}
