"use client";

import type { VaultCredentialMaterial } from "@/lib/privacy/secrets/vault";

import { Fingerprint, Mail, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Redacted } from "@/components/ui/redacted";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { asyncHandler } from "@/lib/async-handler";
import { authClient, useSession } from "@/lib/auth/auth-client";
import { registerPasskeyWithPrf } from "@/lib/auth/passkey/client";
import { checkPrfSupport } from "@/lib/auth/passkey/prf";
import { generatePrfSalt } from "@/lib/privacy/credentials/derivation";

import { VaultRecovery } from "../_components/vault-recovery";

type RecoveryPhase = "email" | "sending" | "sent" | "registering" | "recover";

type PasskeyMaterial = Extract<VaultCredentialMaterial, { type: "passkey" }>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PHASE_DESCRIPTIONS: Record<RecoveryPhase, string> = {
  email: "Lost your passkey? Sign in with an email link and create a new one.",
  sending:
    "Lost your passkey? Sign in with an email link and create a new one.",
  sent: "Check your email for the sign-in link.",
  registering: "Create a new passkey on this device.",
  recover: "Your new passkey is registered.",
};

export default function RecoverPasskeyPage() {
  const { data: session, isPending: sessionLoading } = useSession();

  const [phase, setPhase] = useState<RecoveryPhase>("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);
  const [registering, setRegistering] = useState(false);
  const [newPasskey, setNewPasskey] = useState<PasskeyMaterial | null>(null);

  useEffect(() => {
    if (!sessionLoading && session?.user && phase === "email") {
      setPhase("registering");
    }
  }, [session, sessionLoading, phase]);

  useEffect(() => {
    let active = true;
    checkPrfSupport()
      .then((result) => {
        if (active) {
          setPrfSupported(result.supported);
        }
      })
      .catch(() => {
        // PRF check failed - will be handled by the form
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSendMagicLink = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError("Email is required");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setEmailError("Invalid email address");
      return;
    }

    setEmailError(null);
    setPhase("sending");
    setError(null);

    try {
      await authClient.signIn.magicLink({
        email: trimmed,
        callbackURL: "/recovery/passkey",
      });
      setPhase("sent");
    } catch {
      setError(
        "We couldn't send the link. Check your connection and try again."
      );
      setPhase("email");
    }
  };

  const handleRegisterPasskey = async () => {
    if (!prfSupported) {
      setError("Your device does not support the required passkey features.");
      return;
    }

    setError(null);
    setRegistering(true);
    try {
      const prfSalt = generatePrfSalt();
      const registration = await registerPasskeyWithPrf({
        name: "Recovery Passkey",
        prfSalt,
      });

      if (!registration.ok) {
        throw new Error(registration.message);
      }

      setNewPasskey({
        type: "passkey",
        credentialId: registration.credentialId,
        prfOutput: registration.prfOutput,
        prfSalt,
      });
      setPhase("recover");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to register passkey. Please try again.";
      if (
        !(message.includes("NotAllowedError") || message.includes("cancelled"))
      ) {
        setError(message);
      }
    } finally {
      setRegistering(false);
    }
  };

  if (sessionLoading) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex items-center justify-center py-12">
          <Spinner className="size-8 text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Recover Passkey</CardTitle>
        <CardDescription>{PHASE_DESCRIPTIONS[phase]}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {(phase === "email" || phase === "sending") && (
          <div className="space-y-4">
            <FieldGroup>
              <Field data-invalid={Boolean(emailError)}>
                <FieldLabel htmlFor="recovery-email">Email</FieldLabel>
                <Input
                  aria-invalid={Boolean(emailError)}
                  autoCapitalize="none"
                  autoComplete="email"
                  disabled={phase === "sending"}
                  id="recovery-email"
                  inputMode="email"
                  name="email"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (emailError) {
                      setEmailError(null);
                    }
                    if (error) {
                      setError(null);
                    }
                  }}
                  placeholder="you@example.com"
                  spellCheck={false}
                  type="email"
                  value={email}
                />
                <FieldError>{emailError}</FieldError>
              </Field>
            </FieldGroup>

            <Button
              className="w-full"
              disabled={phase === "sending"}
              onClick={asyncHandler(handleSendMagicLink)}
            >
              {phase === "sending" ? (
                <Spinner aria-hidden="true" className="mr-2" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              Send sign-in link
            </Button>
          </div>
        )}

        {phase === "sent" && (
          <div className="space-y-4 text-center">
            <div className="space-y-2">
              <p className="font-medium">Check your email</p>
              <p className="text-muted-foreground text-sm">
                If an account uses{" "}
                <strong>
                  <Redacted>{email}</Redacted>
                </strong>
                , we sent it a sign-in link. Open it on this device to continue.
              </p>
            </div>
            <Separator />
            <Button
              className="text-sm"
              onClick={() => setPhase("email")}
              variant="outline"
            >
              Use a different email
            </Button>
          </div>
        )}

        {phase === "registering" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Next, you'll open your encrypted data with another way you still
              have, such as your password, wallet, or recovery key, so it moves
              to the new passkey.
            </p>

            {prfSupported === false && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription>
                  This device doesn't support the passkey features Zentity
                  needs. Try a different device or browser.
                </AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              disabled={prfSupported === false || registering}
              onClick={asyncHandler(handleRegisterPasskey)}
              size="lg"
            >
              {registering ? (
                <Spinner aria-hidden="true" className="mr-2" />
              ) : (
                <Fingerprint className="mr-2 h-4 w-4" />
              )}
              Create new passkey
            </Button>
          </div>
        )}

        {phase === "recover" && newPasskey ? (
          <VaultRecovery newPasskey={newPasskey} />
        ) : null}

        {phase !== "recover" && (
          <div className="text-center text-muted-foreground text-sm">
            <Link
              className="font-medium text-primary hover:underline"
              href="/sign-in"
            >
              Back to Sign In
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
