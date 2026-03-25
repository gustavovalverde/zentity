"use client";

import { Fingerprint, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { OpaqueSignInForm } from "@/components/auth/opaque-sign-in-form";
import { SocialLoginButtons } from "@/components/auth/social-login-buttons";

const LazyWalletSignInButton = dynamic(
  () =>
    import("@/components/auth/wallet-sign-in-form").then((m) => ({
      default: m.WalletSignInButton,
    })),
  { ssr: false }
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
import { getPostAuthRedirectUrl } from "@/lib/auth/oauth-post-login";
import { signInWithPasskey } from "@/lib/auth/passkey";
import { prepareForNewSession } from "@/lib/auth/session-manager";
import { checkPrfSupport } from "@/lib/auth/webauthn-prf";
import { getSafeRedirectPath, redirectTo } from "@/lib/utils/navigation";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const callbackURL = getSafeRedirectPath(
    searchParams.get("callbackURL"),
    "/dashboard"
  );
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (searchParams.get("error") === "signup_disabled") {
      toast.error("No account found", {
        description:
          "Please sign up first, then link your social account from Settings.",
      });
      window.history.replaceState({}, "", "/sign-in");
    }
  }, [searchParams]);

  useEffect(() => {
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
      const url = await getPostAuthRedirectUrl(callbackURL);
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
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome Back</CardTitle>
        <CardDescription>Sign in to your Zentity account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
              <Fingerprint className="mr-2 h-4 w-4" />
            )}
            Sign in with Passkey
          </Button>

          <div className="flex justify-end">
            <Link
              className="text-muted-foreground text-xs hover:text-primary hover:underline"
              href="/recovery/guardian"
            >
              Lost your passkey?
            </Link>
          </div>

          {prfSupported === false && (
            <Alert>
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription className="ml-2 text-xs">
                Your browser supports passkeys but not the PRF extension needed
                for vault encryption. Identity verification requires a password
                or a PRF-compatible browser (Chrome, Edge).
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
          <OpaqueSignInForm callbackURL={callbackURL} />
        </div>

        {/* Wallet + Social */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <Separator className="flex-1" />
            <span>Or continue with</span>
            <Separator className="flex-1" />
          </div>
          <LazyWalletSignInButton />
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
