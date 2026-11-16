"use client";

import type { RecoveryOptions } from "@/lib/auth/recovery-factors";
import type {
  VaultCredentialMaterial,
  VaultKey,
} from "@/lib/privacy/secrets/vault";

import { Fingerprint, Mail, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
import { trpc } from "@/lib/trpc/client";

import { RecoveryProofs } from "../_components/recovery-proofs";
import { RemoveUnrecognizedPasskeys } from "../_components/remove-unrecognized-passkeys";
import { VaultRecovery } from "../_components/vault-recovery";

type RecoveryPhase =
  | "email"
  | "sending"
  | "sent"
  | "loading"
  | "confirm"
  | "passkey_works"
  | "registering"
  | "recover"
  | "remove";

type PasskeyMaterial = Extract<VaultCredentialMaterial, { type: "passkey" }>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSKEY_NOT_VERIFIED =
  "Your passkey didn't ask for your PIN, fingerprint, or face, so it can't confirm a recovery. Confirm two other ways instead.";

const PHASE_DESCRIPTIONS: Record<RecoveryPhase, string> = {
  email: "Lost your passkey? Sign in with an email link to start.",
  sending: "Lost your passkey? Sign in with an email link to start.",
  sent: "Check your email for the sign-in link.",
  loading: "Checking your account.",
  confirm: "Confirm it's you without your passkey.",
  passkey_works: "You confirmed it's you with your passkey.",
  registering: "Create a new passkey on this device.",
  recover: "Your new passkey is registered.",
  remove: "Review the passkeys on your account.",
};

/**
 * Account recovery for a lost passkey (`?intent=remove` for a passkey the
 * user does not recognize). Signed out, the user starts with an email link
 * or a password or wallet sign-in. Signed in, the server's recovery factor
 * rule decides whether a passkey may be added; until it allows one, the page
 * asks for the proofs that confirm an account recovery.
 */
export default function RecoverPasskeyPage() {
  const searchParams = useSearchParams();
  const removing = searchParams.get("intent") === "remove";
  const returnTo = removing
    ? "/recovery/passkey?intent=remove"
    : "/recovery/passkey";
  const { data: session, isPending: sessionLoading } = useSession();

  const [phase, setPhase] = useState<RecoveryPhase>("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);
  const [registering, setRegistering] = useState(false);
  const [newPasskey, setNewPasskey] = useState<PasskeyMaterial | null>(null);
  const [options, setOptions] = useState<RecoveryOptions | null>(null);
  const [openedVault, setOpenedVault] = useState<VaultKey | null>(null);
  const [usedRecoveryKey, setUsedRecoveryKey] = useState(false);

  const signedInUser = session?.user ?? null;

  const refreshOptions = useCallback(async () => {
    setPhase("loading");
    try {
      const next = await trpc.account.recoveryOptions.query();
      setOptions(next);
      if (next?.enrollment !== "allowed") {
        setPhase("confirm");
      } else if (removing) {
        setPhase("remove");
      } else if (next.passkeyReverified) {
        // A working passkey is not a lost one: replacing it would retire it.
        setPhase("passkey_works");
      } else {
        setPhase("registering");
      }
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("confirm");
      return null;
    }
  }, [removing]);

  useEffect(() => {
    if (sessionLoading || !signedInUser || phase !== "email") {
      return;
    }
    refreshOptions().catch(() => {
      // refreshOptions reports its own errors
    });
  }, [sessionLoading, signedInUser, phase, refreshOptions]);

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
        callbackURL: returnTo,
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
        <CardTitle className="text-2xl">
          {removing ? "Review Passkeys" : "Recover Passkey"}
        </CardTitle>
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

            <p className="text-center text-muted-foreground text-sm">
              Or{" "}
              <Link
                className="font-medium text-primary hover:underline"
                href={`/sign-in?callbackURL=${encodeURIComponent(returnTo)}`}
              >
                sign in with your password or wallet
              </Link>{" "}
              first.
            </p>
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

        {phase === "loading" && (
          <div className="flex justify-center py-6">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        )}

        {phase === "confirm" && options && signedInUser ? (
          <RecoveryProofs
            email={signedInUser.email}
            onProved={async (proof) => {
              setError(null);
              if (proof.vaultKey) {
                setOpenedVault(proof.vaultKey);
              }
              if (proof.method === "recovery_key") {
                setUsedRecoveryKey(true);
              }
              const next = await refreshOptions();
              if (
                proof.method === "passkey" &&
                next &&
                !next.passkeyReverified
              ) {
                setError(PASSKEY_NOT_VERIFIED);
              }
            }}
            options={options}
            returnTo={returnTo}
            userId={signedInUser.id}
          />
        ) : null}

        {phase === "passkey_works" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Your passkey still works, so there's nothing to recover. Add a
              passkey for this device in Settings, and remove any passkey you no
              longer have there.
            </p>
            <Button asChild className="w-full" size="lg">
              <Link href="/dashboard/settings">Go to Settings</Link>
            </Button>
          </div>
        )}

        {phase === "registering" && (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">
              {openedVault
                ? "Your encrypted data is open and moves to the new passkey."
                : "Next, you'll open your encrypted data with another way you still have, such as your password, wallet, or recovery key, so it moves to the new passkey."}
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
          <VaultRecovery
            newPasskey={newPasskey}
            offerRecoveryKey={usedRecoveryKey}
            openedVault={openedVault}
            passkeyInUse={Boolean(options?.signedInWithPasskey)}
          />
        ) : null}

        {phase === "remove" && (
          <RemoveUnrecognizedPasskeys
            hasPassword={Boolean(options?.hasPassword)}
          />
        )}

        {phase !== "recover" && phase !== "remove" && (
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
