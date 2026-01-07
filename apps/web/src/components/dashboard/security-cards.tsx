"use client";

import {
  ProvidersCard,
  SessionsCard,
  TwoFactorCard,
} from "@daveyplate/better-auth-ui";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SecurityCardsProps {
  readonly hasPassword?: boolean;
}

/**
 * Better Auth UI components for OAuth provider management and session management.
 * These components integrate with the AuthUIProvider to provide:
 * - ProvidersCard: Link/unlink OAuth accounts (Google, GitHub)
 * - SessionsCard: View and revoke active sessions across devices
 * - TwoFactorCard: TOTP 2FA setup (only for password users)
 */
export function SecurityCards({ hasPassword = false }: SecurityCardsProps) {
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
      {/* Two-Factor Authentication - only available for password users */}
      {hasPassword ? (
        <TwoFactorCard
          localization={{
            TWO_FACTOR: "Backup Authentication (TOTP)",
            TWO_FACTOR_DESCRIPTION:
              "Add time-based one-time passwords as a backup sign-in method. Note: TOTP cannot replace your passkey for accessing encrypted data.",
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Backup Authentication</CardTitle>
            <CardDescription>
              Two-factor authentication is available for password-based
              accounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription>
                Set a password in your account settings to enable TOTP backup
                authentication. Note that passkeys remain the primary secure
                method for accessing your encrypted data.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </>
  );
}
