"use client";

import { MailPlus, MailWarning } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { asyncHandler } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { withPasskeyConfirmation } from "@/lib/auth/passkey/client";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";

export function EmailVerificationBanner({
  email,
  emailVerified,
}: Readonly<{ email: string; emailVerified: boolean }>) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (emailVerified) {
    return null;
  }

  const synthetic = isSyntheticEmail(email);

  if (synthetic) {
    return (
      <Alert className="mb-4" variant="info">
        <MailPlus />
        <AlertTitle>No email address</AlertTitle>
        <AlertDescription>
          <p>
            Add an email address to receive notifications and enable account
            recovery.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/settings?tab=profile">Go to settings</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const handleResend = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await withPasskeyConfirmation(() =>
        authClient.sendVerificationEmail({
          email,
          callbackURL: "/dashboard",
        })
      );
      if (result.error) {
        throw new Error(result.error.message);
      }
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't send the verification email. Try again."
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Alert className="mb-4" variant="warning">
      <MailWarning />
      <AlertTitle>Email not verified</AlertTitle>
      <AlertDescription>
        {sent ? (
          <p>Verification email sent. Check your inbox.</p>
        ) : (
          <>
            <p>
              Verify your email to receive notifications and enable account
              recovery.
            </p>
            {error ? <p role="alert">{error}</p> : null}
            <Button
              disabled={sending}
              onClick={asyncHandler(handleResend)}
              size="sm"
              variant="outline"
            >
              {sending ? "Sending…" : "Resend verification email"}
            </Button>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}
