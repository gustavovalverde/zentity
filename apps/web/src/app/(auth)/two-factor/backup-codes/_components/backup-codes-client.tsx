"use client";

import { Download } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { asyncHandler, reportRejection } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { invalidateSessionDataCache } from "@/lib/auth/session-cleanup";

// Better Auth's shouldRequirePassword (utils/password.mjs) returns true
// whenever the user has a credential-provider account with a password — even
// when the twoFactor plugin is configured with allowPasswordless: true.
// Users who signed up with email/password must re-enter their password to
// generate backup codes. This page handles both paths:
//   - With password: show prompt, submit via authClient.twoFactor.generateBackupCodes
//   - Without password (passkey / wallet only): auto-generate on mount

export function BackupCodesClient() {
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDownloaded, setHasDownloaded] = useState(false);

  useEffect(() => {
    let active = true;

    const tryPasswordlessGenerate = async () => {
      // /two-factor/verify just flipped twoFactorEnabled=true in the DB. The
      // session_data cookie still caches the old value — force a DB read
      // before any twoFactor endpoint call to avoid TWO_FACTOR_NOT_ENABLED.
      invalidateSessionDataCache();
      await authClient.getSession({ query: { disableCookieCache: true } });

      try {
        const result = await authClient.twoFactor.generateBackupCodes({
          fetchOptions: { throw: true },
        });
        if (active && result.backupCodes) {
          setBackupCodes(result.backupCodes);
        }
      } catch {
        // Expected for credential users — they'll enter their password.
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    tryPasswordlessGenerate().catch(reportRejection);

    return () => {
      active = false;
    };
  }, []);

  const handlePasswordSubmit = async (
    event: React.SubmitEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!password.trim()) {
      setError("Password is required");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      invalidateSessionDataCache();
      await authClient.getSession({ query: { disableCookieCache: true } });
      const result = await authClient.twoFactor.generateBackupCodes({
        password: password.trim(),
        fetchOptions: { throw: true },
      });
      if (result.backupCodes) {
        setBackupCodes(result.backupCodes);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate backup codes"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownload = () => {
    const content = ["Zentity Backup Codes", "", ...backupCodes].join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zentity-backup-codes.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setHasDownloaded(true);
  };

  const handleContinue = () => {
    globalThis.window.location.assign("/dashboard/settings");
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
        </CardContent>
      </Card>
    );
  }

  if (backupCodes.length === 0) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Confirm your password</CardTitle>
          <CardDescription>
            Re-enter your password to generate your backup codes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={asyncHandler(handlePasswordSubmit)}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
                <Input
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  id={passwordId}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError(null);
                  }}
                  placeholder="Enter your password"
                  type="password"
                  value={password}
                />
                <FieldError>{error}</FieldError>
              </Field>
            </FieldGroup>
            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? (
                <Spinner aria-hidden="true" className="mr-2" />
              ) : null}
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Save your backup codes</CardTitle>
        <CardDescription>
          Store these codes somewhere safe. You can use them to access your
          account if you lose your authenticator device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-2">
          {backupCodes.map((code) => (
            <div
              className="rounded-md bg-muted p-2 text-center font-mono text-sm"
              key={code}
            >
              {code}
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <Button className="w-full" onClick={handleDownload} variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Download Backup Codes
          </Button>

          <Button
            className="w-full"
            disabled={!hasDownloaded}
            onClick={handleContinue}
          >
            Continue
          </Button>

          {hasDownloaded ? null : (
            <p className="text-center text-muted-foreground text-xs">
              Please download your backup codes before continuing.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
