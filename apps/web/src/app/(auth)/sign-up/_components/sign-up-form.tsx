"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { asyncHandler, reportRejection } from "@/lib/async-handler";
import {
  isPasskeyAlreadyRegistered,
  registerPasskeyWithPrf,
  signInWithPasskey,
} from "@/lib/auth/passkey/client";
import { checkPrfSupport } from "@/lib/auth/passkey/prf";
import { redirectTo } from "@/lib/auth/redirect";
import {
  ensureAuthSession,
  invalidateSessionDataCache,
  prepareForNewSession,
} from "@/lib/auth/session-cleanup";
import { trpc } from "@/lib/trpc/client";

import { CredentialChoice, type CredentialType } from "./credential-choice";
import { PasswordSignUpForm } from "./password-signup-form";
import { WalletSignUpForm } from "./wallet-signup-form";

export function SignUpForm() {
  const emailId = useId();
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [credentialType, setCredentialType] = useState<CredentialType | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PRF support check
  const [prfStatus, setPrfStatus] = useState<{
    supported: boolean;
    reason?: string | undefined;
  } | null>(null);

  // Clean stale state on mount (each credential path creates its own session on demand)
  useEffect(() => {
    prepareForNewSession();
  }, []);

  // Check PRF support on mount
  useEffect(() => {
    let active = true;
    checkPrfSupport()
      .then((result) => {
        if (active) {
          setPrfStatus(result);
        }
      })
      .catch(reportRejection);
    return () => {
      active = false;
    };
  }, []);

  const finalizeSignUp = (nextPath = "/dashboard") => {
    setIsRedirecting(true);
    redirectTo(nextPath);
  };

  const completeAccountCreation = async (params?: {
    wallet?: { address: string; chainId: number };
  }) => {
    await trpc.signUp.completeAccountCreation.mutate({
      email: email.trim() || undefined,
      wallet: params?.wallet,
    });

    // The tRPC mutation updated user data (email, name, isAnonymous) in the DB
    // via Drizzle, bypassing better-auth's session cookie cache. Clear the stale
    // session_data cookie so the dashboard reads fresh data from the database.
    invalidateSessionDataCache();
  };

  const handleCreatePasskey = async () => {
    if (!prfStatus?.supported) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await ensureAuthSession();

      const prfSalt = crypto.getRandomValues(new Uint8Array(32));

      const resolvedEmail =
        emailRef.current?.value.trim() || email.trim() || "";

      // Sync React state in case browser autofill didn't fire onChange
      if (resolvedEmail && resolvedEmail !== email.trim()) {
        setEmail(resolvedEmail);
      }

      const registration = await registerPasskeyWithPrf({
        name: resolvedEmail || "Primary Passkey",
        prfSalt,
      });

      let credentialId: string | null = null;
      let prfOutput: Uint8Array | null = null;

      if (!registration.ok && isPasskeyAlreadyRegistered(registration.error)) {
        const authResult = await signInWithPasskey({
          prfSalt,
          allowPrfFallback: false,
        });
        if (!authResult.ok) {
          const message =
            authResult.error?.code === "AUTH_CANCELLED"
              ? "Passkey sign-in was cancelled."
              : authResult.message ||
                "This passkey is already registered. Please sign in to continue.";
          throw new Error(message);
        }
        credentialId = authResult.credentialId ?? null;
        prfOutput = authResult.prfOutput ?? null;
      } else {
        if (!registration.ok) {
          throw new Error(registration.message);
        }
        credentialId = registration.credentialId;
        prfOutput = registration.prfOutput;
      }

      if (!(credentialId && prfOutput)) {
        throw new Error(
          "This passkey doesn't support the encryption features needed. Please try a different passkey or use a password instead."
        );
      }

      await completeAccountCreation();
      finalizeSignUp();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating your account."
      );
      setCredentialType(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSignUp = async (_result: {
    userId: string;
    email: string;
    exportKey: Uint8Array;
  }) => {
    setIsSubmitting(true);
    setError(null);

    try {
      await completeAccountCreation();
      finalizeSignUp();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating your account."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWalletSignUp = async (result: {
    userId: string;
    address: string;
    chainId: number;
  }) => {
    setIsSubmitting(true);
    setError(null);

    try {
      await completeAccountCreation({
        wallet: { address: result.address, chainId: result.chainId },
      });
      finalizeSignUp("/dashboard/settings?tab=recovery&walletRisk=1");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while creating your account."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCredentialSelect = (type: CredentialType) => {
    setError(null);

    if (type === "passkey") {
      setCredentialType("passkey");
      handleCreatePasskey().catch(reportRejection);
      return;
    }

    if (type === "wallet") {
      // Toggle: clicking wallet again collapses it
      setCredentialType(credentialType === "wallet" ? null : "wallet");
      return;
    }

    // Password: toggle inline form
    setCredentialType(credentialType === "password" ? null : "password");
  };

  const prfUnsupportedMessage =
    prfStatus && !prfStatus.supported
      ? prfStatus.reason ||
        "Passkeys with encryption support are not available on this device or browser."
      : null;

  if (isRedirecting) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          <span>Finalizing your account…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Email input (always visible, editable until submitting) */}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={emailId}>Email Address (optional)</FieldLabel>
          <Input
            autoCapitalize="none"
            autoComplete="email"
            disabled={isSubmitting}
            id={emailId}
            inputMode="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            ref={emailRef}
            spellCheck={false}
            type="email"
            value={email}
          />
          <p className="text-muted-foreground text-xs">
            Optional. Used to identify your account.
          </p>
        </Field>
      </FieldGroup>

      {/* PRF unsupported warning */}
      {!!prfUnsupportedMessage && (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            {prfUnsupportedMessage}
            <div className="mt-2 text-muted-foreground text-xs">
              Supported: Chrome or Edge on Windows/Mac/Android, Safari on iOS
              17+ or macOS Sonoma+. Firefox does not currently support the
              required PRF extension.
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Error display */}
      {!!error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* PRF check loading indicator */}
      {!prfStatus && (
        <p className="text-muted-foreground text-xs">
          Checking passkey support…
        </p>
      )}

      {/* Credential cards (always visible) */}
      <CredentialChoice
        activeType={credentialType}
        disabled={isSubmitting}
        onSelect={handleCredentialSelect}
        prfSupported={prfStatus?.supported ?? false}
        processingType={isSubmitting ? credentialType : null}
      />

      {/* Inline expanded forms (below cards) */}
      {credentialType === "password" && !isSubmitting && (
        <PasswordSignUpForm
          disabled={isSubmitting}
          email={email}
          onSuccess={asyncHandler(handlePasswordSignUp)}
        />
      )}

      {credentialType === "wallet" && !isSubmitting && (
        <WalletSignUpForm
          disabled={isSubmitting}
          email={email}
          onSuccess={asyncHandler(handleWalletSignUp)}
        />
      )}

      {/* Sign in link */}
      <div className="text-center text-muted-foreground text-sm">
        Already have an account?{" "}
        <Link
          className="font-medium text-primary hover:underline"
          href="/sign-in"
        >
          Sign In
        </Link>
      </div>
    </div>
  );
}
