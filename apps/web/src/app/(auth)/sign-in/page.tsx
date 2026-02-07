"use client";

import { KeyRound, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { OpaqueSignInForm } from "@/components/auth/opaque-sign-in-form";
import { SocialLoginButtons } from "@/components/auth/social-login-buttons";

const LazyWalletSignInButton = lazy(() =>
  import("@/components/auth/wallet-sign-in-form").then((m) => ({
    default: m.WalletSignInButton,
  }))
);

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";
import { getPostAuthRedirectUrl } from "@/lib/auth/oauth-post-login";
import { signInWithPasskey } from "@/lib/auth/passkey";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { checkPrfSupport } from "@/lib/auth/webauthn-prf";
import { redirectTo } from "@/lib/utils/navigation";

function getLastUsedLabel(method: string | null): string | null {
  if (!method) {
    return null;
  }
  if (method === "passkey") {
    return "Passkey";
  }
  if (method === "wallet" || method === "siwe") {
    return "Wallet";
  }
  if (method === "opaque") {
    return "Password";
  }
  if (method === "credential" || method === "email") {
    return "Email/Password";
  }
  if (method === "google") {
    return "Google";
  }
  if (method === "github") {
    return "GitHub";
  }
  return method;
}

export default function SignInPage() {
  const [lastUsedMethod, setLastUsedMethod] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setLastUsedMethod(authClient.getLastUsedLoginMethod?.() ?? null);

    let active = true;
    checkPrfSupport()
      .then((result) => {
        if (active) {
          setPrfSupported(result.supported);
        }
      })
      .catch(() => {
        // PRF is optional; sign-in works without it
      });
    return () => {
      active = false;
    };
  }, []);

  const handlePasskeySignIn = async () => {
    setPasskeyLoading(true);
    setPasskeyError(null);
    prepareForNewSession();

    try {
      const result = await signInWithPasskey();
      if (!result.ok) {
        throw new Error(result.message);
      }

      toast.success("Signed in successfully!");
      const url = await getPostAuthRedirectUrl("/dashboard");
      redirectTo(url);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Passkey authentication failed. Please try again.";

      if (
        message.includes("NotAllowedError") ||
        message.includes("cancelled")
      ) {
        setPasskeyError(null);
        setPasskeyLoading(false);
        return;
      }

      setPasskeyError(message);
      toast.error("Sign in failed", { description: message });
      setPasskeyLoading(false);
    }
  };

  const lastUsedLabel = getLastUsedLabel(lastUsedMethod);

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome Back</CardTitle>
        <CardDescription>Sign in to your Zentity account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {lastUsedLabel ? (
          <p className="text-center text-muted-foreground text-xs">
            Last used:{" "}
            <span className="font-medium text-foreground">{lastUsedLabel}</span>
          </p>
        ) : null}

        {/* Passkey — primary CTA */}
        <div className="space-y-2">
          {passkeyError ? (
            <Alert variant="destructive">
              <AlertDescription>{passkeyError}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            className="w-full"
            disabled={passkeyLoading}
            onClick={handlePasskeySignIn}
            size="lg"
          >
            {passkeyLoading ? (
              <Spinner aria-hidden="true" className="mr-2" size="sm" />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" />
            )}
            Sign in with Passkey
          </Button>

          <div className="flex justify-end">
            <Link
              className="text-muted-foreground text-xs hover:text-primary hover:underline"
              href="/recover-social"
            >
              Lost your passkey?
            </Link>
          </div>

          {prfSupported === false && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription className="ml-2 text-xs">
                Your device supports passkeys but some advanced encryption
                features may be limited.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Password */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <Separator className="flex-1" />
            <span>Or sign in with password</span>
            <Separator className="flex-1" />
          </div>
          <OpaqueSignInForm />
        </div>

        {/* Wallet + Social */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <Separator className="flex-1" />
            <span>Or continue with</span>
            <Separator className="flex-1" />
          </div>
          <Suspense>
            <LazyWalletSignInButton />
          </Suspense>
          <SocialLoginButtons />
        </div>

        {/* Footer */}
        <p className="text-center text-muted-foreground text-sm">
          Need an account?{" "}
          <Link
            className="font-medium text-primary hover:underline"
            href="/sign-up"
          >
            Sign Up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
