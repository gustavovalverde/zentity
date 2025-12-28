"use client";

import { Github, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth";

// Google icon component
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

interface OAuthButtonsProps {
  mode?: "signin" | "link";
  onSuccess?: () => void;
}

export function OAuthButtons({
  mode = "signin",
  onSuccess,
}: OAuthButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  const handleOAuth = async (provider: "google" | "github") => {
    setLoadingProvider(provider);

    try {
      if (mode === "link") {
        // Link OAuth account to existing user
        const result = await authClient.linkSocial({
          provider,
          callbackURL: "/dashboard/settings",
        });

        if (result.error) {
          toast.error(`Failed to link ${provider}`, {
            description: result.error.message,
          });
        } else {
          toast.success(`${provider} account linked successfully`);
          onSuccess?.();
        }
      } else {
        // Sign in with OAuth
        const result = await authClient.signIn.social({
          provider,
          callbackURL: "/dashboard",
          errorCallbackURL: "/sign-in?error=oauth_failed",
        });

        if (result.error) {
          // Check if user doesn't exist (they need identity verification first)
          if (
            result.error.message?.includes("user") ||
            result.error.message?.includes("not found")
          ) {
            toast.error("Account not found", {
              description:
                "Please sign up first to complete identity verification before using OAuth.",
            });
          } else {
            toast.error(`Failed to sign in with ${provider}`, {
              description: result.error.message,
            });
          }
        }
      }
    } catch (error) {
      toast.error("An error occurred", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setLoadingProvider(null);
    }
  };

  const isGoogleConfigured = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CONFIGURED);
  const isGitHubConfigured = Boolean(process.env.NEXT_PUBLIC_GITHUB_CONFIGURED);

  // If no providers configured, show a message
  if (!isGoogleConfigured && !isGitHubConfigured) {
    return (
      <div className="text-center text-sm text-muted-foreground py-4">
        <p>OAuth providers not configured.</p>
        <p className="text-xs mt-1">
          Add GOOGLE_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET to enable.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isGoogleConfigured && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => handleOAuth("google")}
          disabled={loadingProvider !== null}
        >
          {loadingProvider === "google" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <GoogleIcon className="mr-2 h-4 w-4" />
          )}
          {mode === "link" ? "Link Google Account" : "Continue with Google"}
        </Button>
      )}

      {isGitHubConfigured && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => handleOAuth("github")}
          disabled={loadingProvider !== null}
        >
          {loadingProvider === "github" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Github className="mr-2 h-4 w-4" />
          )}
          {mode === "link" ? "Link GitHub Account" : "Continue with GitHub"}
        </Button>
      )}
    </div>
  );
}
