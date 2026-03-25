"use client";

import { MailPlus, MailWarning } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";
import { isSyntheticEmail } from "@/lib/auth/email-classification";

export function EmailVerificationBanner({
  email,
  emailVerified,
}: Readonly<{ email: string; emailVerified: boolean }>) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

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
    try {
      await authClient.sendVerificationEmail({
        email,
        callbackURL: "/dashboard",
      });
      setSent(true);
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
            <Button
              disabled={sending}
              onClick={handleResend}
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
