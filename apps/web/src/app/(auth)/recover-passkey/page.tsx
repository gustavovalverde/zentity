"use client";

import { Check, KeyRound, Loader2, Mail, TriangleAlert } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient, useSession } from "@/lib/auth";
import { generatePrfSalt } from "@/lib/crypto/key-derivation";
import {
  checkPrfSupport,
  createCredentialWithPrf,
  evaluatePrf,
  extractCredentialRegistrationData,
} from "@/lib/crypto/webauthn-prf";
import { trpc } from "@/lib/trpc/client";
import { base64UrlToBytes } from "@/lib/utils";

type RecoveryPhase = "email" | "sending" | "sent" | "registering" | "complete";

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  Uint8Array.from(bytes).buffer;

export default function RecoverPasskeyPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = useSession();

  const [phase, setPhase] = useState<RecoveryPhase>("email");
  const [email, setEmail] = useState("");
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
    void checkPrfSupport().then((result) => {
      if (active) setPrfSupported(result.supported);
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSendMagicLink = async () => {
    if (!email) {
      setError("Please enter your email address.");
      return;
    }

    setPhase("sending");
    setError(null);

    try {
      const result = await authClient.signIn.magicLink({
        email,
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
        err instanceof Error ? err.message : "An unexpected error occurred",
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
      // Get registration options
      const options = await trpc.passkeyAuth.getAddCredentialOptions.query();
      const prfSalt = generatePrfSalt();

      // Build WebAuthn options
      const webAuthnOptions: PublicKeyCredentialCreationOptions = {
        rp: {
          id: options.rp.id,
          name: options.rp.name,
        },
        user: {
          id: Uint8Array.from(new TextEncoder().encode(options.user.id)),
          name: options.user.email,
          displayName: options.user.name,
        },
        challenge: Uint8Array.from(base64UrlToBytes(options.challenge)),
        pubKeyCredParams: [
          { type: "public-key" as const, alg: -8 },
          { type: "public-key" as const, alg: -7 },
          { type: "public-key" as const, alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "required" as const,
          userVerification: "required" as const,
        },
        timeout: 60_000,
        attestation: "none" as const,
        excludeCredentials: options.excludeCredentials?.map((cred) => ({
          type: "public-key" as const,
          id: toArrayBuffer(base64UrlToBytes(cred.id)),
          transports: cred.transports as AuthenticatorTransport[],
        })),
        extensions: {
          prf: {
            eval: {
              first: toArrayBuffer(prfSalt),
            },
          },
        },
      };

      // Create passkey
      const {
        credential,
        credentialId,
        prfOutput: initialPrfOutput,
      } = await createCredentialWithPrf(webAuthnOptions);

      // Evaluate PRF if not available during creation
      let prfOutput = initialPrfOutput;
      if (!prfOutput) {
        const { prfOutputs } = await evaluatePrf({
          credentialIdToSalt: { [credentialId]: prfSalt },
        });
        prfOutput =
          prfOutputs.get(credentialId) ??
          prfOutputs.values().next().value ??
          null;
      }
      if (!prfOutput) {
        throw new Error(
          "This passkey did not return PRF output. Please try a different authenticator.",
        );
      }

      // Extract credential data
      const credentialData = extractCredentialRegistrationData(credential);

      // Register with server
      await trpc.passkeyAuth.addCredential.mutate({
        challengeId: options.challengeId,
        credential: {
          credentialId: credentialData.credentialId,
          publicKey: credentialData.publicKey,
          counter: credentialData.counter,
          deviceType: credentialData.deviceType,
          backedUp: credentialData.backedUp,
          transports: credentialData.transports,
          name: "Recovery Passkey",
        },
      });

      // Note: We don't automatically re-wrap FHE keys here because
      // we may not have the original PRF output. User can do this
      // from settings if needed.

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
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
        <CardDescription>
          {phase === "email" || phase === "sending"
            ? "Lost your passkey? We'll help you set up a new one."
            : phase === "sent"
              ? "Check your email for the recovery link."
              : phase === "registering"
                ? "Create a new passkey to secure your account."
                : "Your new passkey is ready to use!"}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Phase 1: Enter email */}
        {(phase === "email" || phase === "sending") && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">Recovery via Magic Link</span>
              </div>
              <p className="text-sm text-muted-foreground">
                We'll send you a magic link to verify your identity. After
                clicking the link, you can register a new passkey.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={phase === "sending"}
              />
            </div>

            <Button
              className="w-full"
              onClick={handleSendMagicLink}
              disabled={phase === "sending" || !email}
            >
              {phase === "sending" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Recovery Link
                </>
              )}
            </Button>
          </div>
        )}

        {/* Phase 2: Magic link sent */}
        {phase === "sent" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <Mail className="h-8 w-8 text-success" />
            </div>
            <div className="space-y-2">
              <p className="font-medium">Check your email</p>
              <p className="text-sm text-muted-foreground">
                We sent a recovery link to <strong>{email}</strong>
              </p>
              <p className="text-sm text-muted-foreground">
                Click the link in the email to continue setting up your new
                passkey.
              </p>
            </div>
            <Separator />
            <Button
              variant="ghost"
              className="text-sm"
              onClick={() => setPhase("email")}
            >
              Use a different email
            </Button>
          </div>
        )}

        {/* Phase 3: Register new passkey */}
        {phase === "registering" && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">Register New Passkey</span>
              </div>
              <p className="text-sm text-muted-foreground">
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
                <strong>Note:</strong> If you had FHE encryption keys protected
                by your old passkey, you may need to re-verify your identity to
                generate new keys.
              </AlertDescription>
            </Alert>

            <Button
              className="w-full"
              size="lg"
              onClick={handleRegisterPasskey}
              disabled={prfSupported === false}
            >
              <KeyRound className="mr-2 h-4 w-4" />
              Create New Passkey
            </Button>
          </div>
        )}

        {/* Phase 4: Complete */}
        {phase === "complete" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <Check className="h-8 w-8 text-success" />
            </div>
            <div className="space-y-2">
              <p className="font-medium">All set!</p>
              <p className="text-sm text-muted-foreground">
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
          <div className="text-center text-sm text-muted-foreground">
            <Link
              href="/sign-in"
              className="font-medium text-primary hover:underline"
            >
              Back to Sign In
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
