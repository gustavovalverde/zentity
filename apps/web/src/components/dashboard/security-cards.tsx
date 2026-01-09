"use client";

import {
  ProvidersCard,
  SessionsCard,
  TwoFactorCard,
} from "@daveyplate/better-auth-ui";

/**
 * Better Auth UI components for OAuth provider management and session management.
 * These components integrate with the AuthUIProvider to provide:
 * - ProvidersCard: Link/unlink OAuth accounts (Google, GitHub)
 * - SessionsCard: View and revoke active sessions across devices
 * - TwoFactorCard: TOTP 2FA setup (passwordless allowed)
 */
interface SecurityCardsProps {
  hasPassword: boolean;
}

export function SecurityCards({ hasPassword }: SecurityCardsProps) {
  return (
    <>
      <ProvidersCard
        localization={{
          PROVIDERS: "Connected Accounts",
          PROVIDERS_DESCRIPTION:
            "Link your OAuth accounts for alternative sign-in methods",
        }}
      />
      <SessionsCard
        localization={{
          SESSIONS: "Active Sessions",
          SESSIONS_DESCRIPTION:
            "View and manage your active sessions across devices. Revoke any session you don't recognize.",
          CURRENT_SESSION: "Current Session",
          REVOKE: "Revoke",
        }}
      />
      <TwoFactorCard
        localization={{
          TWO_FACTOR: "Two-factor authentication",
          TWO_FACTOR_CARD_DESCRIPTION:
            "Add an authenticator app to secure sign-in and approve recovery.",
          TWO_FACTOR_ENABLE_INSTRUCTIONS:
            "Scan a QR code with your authenticator app to enable two-factor authentication.",
          TWO_FACTOR_DISABLE_INSTRUCTIONS:
            "Disable two-factor authentication and remove your backup codes.",
        }}
        requirePassword={hasPassword}
      />
    </>
  );
}
