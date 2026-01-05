"use client";

import { KeyRound, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import {
  authenticateWithPasskey,
  checkPrfSupport,
} from "@/lib/crypto/webauthn-prf";
import { trpc } from "@/lib/trpc/client";
import { base64UrlToBytes } from "@/lib/utils/base64url";

type AuthStatus = "idle" | "checking" | "authenticating" | "verifying";

export function PasskeySignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);

  // Check PRF support on mount (informational only - not required for auth)
  useEffect(() => {
    let active = true;
    checkPrfSupport()
      .then((result) => {
        if (active) {
          setPrfSupported(result.supported);
        }
      })
      .catch(() => {
        // PRF is optional; fallback behavior defined
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSignIn = async () => {
    setStatus("checking");
    setError(null);

    // Clear any stale caches from previous session
    prepareForNewSession();

    try {
      // Step 1: Get authentication options from server
      const options = await trpc.passkeyAuth.getAuthenticationOptions.query({});

      // Step 2: Authenticate with passkey
      setStatus("authenticating");
      const { assertion } = await authenticateWithPasskey({
        challenge: base64UrlToBytes(options.challenge),
        allowCredentials: options.allowCredentials?.map((cred) => ({
          id: cred.id,
          transports: cred.transports as AuthenticatorTransport[],
        })),
        userVerification: "required",
        timeoutMs: 60_000,
      });

      // Step 3: Verify assertion on server
      setStatus("verifying");
      const result = await trpc.passkeyAuth.verifyAuthentication.mutate({
        challengeId: options.challengeId,
        assertion,
      });

      if (!result.success) {
        throw new Error("Authentication failed. Please try again.");
      }

      toast.success("Signed in successfully!");
      window.location.assign("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Passkey authentication failed. Please try again.";

      // Handle user cancellation gracefully
      if (
        message.includes("NotAllowedError") ||
        message.includes("cancelled")
      ) {
        setError(null);
        setStatus("idle");
        return;
      }

      setError(message);
      toast.error("Sign in failed", { description: message });
      setStatus("idle");
    }
  };

  const isLoading = status !== "idle";

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Sign in with Passkey</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Use your device's biometrics (Face ID, Touch ID, Windows Hello) or
            security key to sign in securely without a password.
          </p>
        </CardContent>
      </Card>

      <Button
        className="w-full"
        disabled={isLoading}
        onClick={handleSignIn}
        size="lg"
        type="button"
      >
        {status === "checking" && (
          <>
            <Spinner className="mr-2" size="sm" />
            Getting options...
          </>
        )}
        {status === "authenticating" && (
          <>
            <Spinner className="mr-2" size="sm" />
            Waiting for passkey...
          </>
        )}
        {status === "verifying" && (
          <>
            <Spinner className="mr-2" size="sm" />
            Signing in...
          </>
        )}
        {status === "idle" && (
          <>
            <KeyRound className="mr-2 h-4 w-4" />
            Sign in with Passkey
          </>
        )}
      </Button>

      {prfSupported === false && (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription className="ml-2 text-xs">
            Your device supports passkeys but not PRF. Some features like FHE
            key auto-unlock may not be available.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2 text-center text-muted-foreground text-sm">
        <p>
          Lost your passkey?{" "}
          <Link
            className="font-medium text-primary hover:underline"
            href="/recover-passkey"
          >
            Recover with magic link
          </Link>
        </p>
      </div>
    </div>
  );
}
