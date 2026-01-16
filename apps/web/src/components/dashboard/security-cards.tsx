"use client";

import {
  SessionsCard as BetterAuthSessionsCard,
  TwoFactorCard as BetterAuthTwoFactorCard,
  ProvidersCard,
} from "@daveyplate/better-auth-ui";

/**
 * Two-Factor Authentication Card
 *
 * TOTP-based 2FA setup. Once enabled, can be linked as a recovery guardian
 * in the Recovery tab.
 */
export function TwoFactorCard() {
  return (
    <BetterAuthTwoFactorCard
      localization={{
        TWO_FACTOR: "Two-factor authentication",
        TWO_FACTOR_CARD_DESCRIPTION:
          "Add an authenticator app for extra security when signing in. Once enabled, you can also use it as a recovery guardian.",
        TWO_FACTOR_ENABLE_INSTRUCTIONS:
          "Confirm to enable two-factor authentication.",
        TWO_FACTOR_DISABLE_INSTRUCTIONS:
          "Confirm to disable two-factor authentication.",
      }}
    />
  );
}

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

/**
 * Connected Accounts Card (OAuth Providers)
 *
 * Link/unlink OAuth accounts for alternative sign-in methods.
 */
export function ConnectedAccountsCard() {
  return (
    <ProvidersCard
      localization={{
        PROVIDERS: "Connected Accounts",
        PROVIDERS_DESCRIPTION:
          "Link your OAuth accounts for alternative sign-in methods",
      }}
    />
  );
}
