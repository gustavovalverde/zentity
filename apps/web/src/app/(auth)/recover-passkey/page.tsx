"use client";

import { Check, KeyRound, Mail, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient, useSession } from "@/lib/auth/auth-client";
import { registerPasskeyWithPrf } from "@/lib/auth/passkey";
import { checkPrfSupport } from "@/lib/auth/webauthn-prf";
import { generatePrfSalt } from "@/lib/privacy/credentials";
import { addWrapperForSecretType } from "@/lib/privacy/secrets";
import { SECRET_TYPES } from "@/lib/privacy/secrets/types";

type RecoveryPhase = "email" | "sending" | "sent" | "registering" | "complete";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getPhaseDescription(phase: RecoveryPhase): string {
  if (phase === "email" || phase === "sending") {
    return "Lost your passkey? We'll help you set up a new one.";
  }
  if (phase === "sent") {
    return "Check your email for the recovery link.";
  }
  if (phase === "registering") {
    return "Create a new passkey to secure your account.";
  }
  return "Your new passkey is ready to use!";
}

export default function RecoverPasskeyPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSession();

  const [phase, setPhase] = useState<RecoveryPhase>("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);

  // Check if user is already authenticated (came via magic link)
  useEffect(() => {
    if (!sessionLoading && session?.user) {
      // User is authenticated, proceed to passkey registration
      setPhase("registering");
      setEmail(session.user.email || "");
    }
  }, [session, sessionLoading]);

  // Check PRF support
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
      const result = await authClient.signIn.magicLink({
        email: trimmed,
        callbackURL: "/recover-passkey",
      });

      if (result.error) {
        if (
          result.error.message?.includes("user") ||
          result.error.message?.includes("not found")
        ) {
          setError("No account found with this email. Please sign up first.");
        } else {
          setError(result.error.message || "Failed to send recovery link");
        }
        setPhase("email");
        return;
      }

      setPhase("sent");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
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

    try {
      const prfSalt = generatePrfSalt();

      const registration = await registerPasskeyWithPrf({
        name: "Recovery Passkey",
        prfSalt,
      });

      if (!registration.ok) {
        throw new Error(registration.message);
      }

      const { credentialId, prfOutput } = registration;

      await addWrapperForSecretType({
        secretType: SECRET_TYPES.FHE_KEYS,
        newCredentialId: credentialId,
        newPrfOutput: prfOutput,
        newPrfSalt: prfSalt,
      });

      await addWrapperForSecretType({
        secretType: SECRET_TYPES.PROFILE,
        newCredentialId: credentialId,
        newPrfOutput: prfOutput,
        newPrfSalt: prfSalt,
      });

      setPhase("complete");
      toast.success("Passkey registered successfully!");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to register passkey. Please try again.";

      if (
        message.includes("NotAllowedError") ||
        message.includes("cancelled")
      ) {
        return; // User cancelled
      }

      setError(message);
      toast.error("Registration failed", { description: message });
    }
  };

  // Loading state while checking session
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
          {phase === "complete" ? "Passkey Recovered" : "Recover Passkey"}
        </CardTitle>
        <CardDescription>{getPhaseDescription(phase)}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* Phase 1: Enter email */}
        {(phase === "email" || phase === "sending") && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">Recovery via Magic Link</span>
              </div>
              <p className="text-muted-foreground text-sm">
                We'll send you a magic link to verify your identity. After
                clicking the link, you can register a new passkey.
              </p>
            </div>

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
              onClick={handleSendMagicLink}
            >
              {phase === "sending" ? (
                <Spinner aria-hidden="true" className="mr-2" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              Send Recovery Link
            </Button>
          </div>
        )}

        {/* Phase 2: Magic link sent */}
        {phase === "sent" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <Mail className="h-8 w-8 text-success" />
            </div>
            <div className="space-y-2">
              <p className="font-medium">Check your email</p>
              <p className="text-muted-foreground text-sm">
                We sent a recovery link to <strong>{email}</strong>
              </p>
              <p className="text-muted-foreground text-sm">
                Click the link in the email to continue setting up your new
                passkey.
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

        {/* Phase 3: Register new passkey */}
        {phase === "registering" && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">Register New Passkey</span>
              </div>
              <p className="text-muted-foreground text-sm">
                Create a new passkey to replace your lost one. Your account data
                remains intact.
              </p>
            </div>

            {prfSupported === false && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="ml-2">
                  Your device doesn't support the required passkey features.
                  Please try from a different device.
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <AlertDescription className="text-sm">
                <strong>Note:</strong> We&apos;ll try to re-secure your existing
                encrypted keys with this new passkey. If that isn&apos;t
                possible, you may need to re-verify your identity to generate
                fresh keys.
              </AlertDescription>
            </Alert>

            <Button
              className="w-full"
              disabled={prfSupported === false}
              onClick={handleRegisterPasskey}
              size="lg"
            >
              <KeyRound className="mr-2 h-4 w-4" />
              Create New Passkey
            </Button>
          </div>
        )}

        {/* Phase 4: Complete */}
        {phase === "complete" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <Check className="h-8 w-8 text-success" />
            </div>
            <div className="space-y-2">
              <p className="font-medium">All set!</p>
              <p className="text-muted-foreground text-sm">
                Your new passkey has been registered. You can now use it to sign
                in to your account.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => router.push("/dashboard")}
            >
              Go to Dashboard
            </Button>
          </div>
        )}

        {/* Back to sign in link */}
        {phase !== "complete" && (
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
