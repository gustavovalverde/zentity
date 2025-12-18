"use client";

import { Github, Key, Loader2, Mail, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

interface LinkedAccount {
  provider: string;
  providerId: string;
}

interface AuthMethodsSectionProps {
  email: string;
  hasPassword: boolean;
  linkedAccounts: LinkedAccount[];
}

export function AuthMethodsSection({
  email,
  hasPassword,
  linkedAccounts,
}: AuthMethodsSectionProps) {
  const router = useRouter();
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(
    null,
  );

  const isGoogleLinked = linkedAccounts.some((a) => a.provider === "google");
  const isGitHubLinked = linkedAccounts.some((a) => a.provider === "github");

  const handleUnlink = async (provider: string) => {
    // Safety check: don't allow unlinking if it's the only auth method
    const methodCount = (hasPassword ? 1 : 0) + linkedAccounts.length;
    if (methodCount <= 1) {
      toast.error("Cannot unlink", {
        description: "You must have at least one authentication method.",
      });
      return;
    }

    setUnlinkingProvider(provider);

    try {
      const result = await authClient.unlinkAccount({
        providerId: provider,
      });

      if (result.error) {
        toast.error(`Failed to unlink ${provider}`, {
          description: result.error.message,
        });
      } else {
        toast.success(`${provider} account unlinked`);
        router.refresh();
      }
    } catch (error) {
      toast.error("An error occurred", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setUnlinkingProvider(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Authentication Methods
        </CardTitle>
        <CardDescription>
          Manage how you sign in to your account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Email/Password */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">Email & Password</p>
              <p className="text-sm text-muted-foreground">{email}</p>
            </div>
          </div>
          <Badge variant={hasPassword ? "default" : "outline"}>
            {hasPassword ? "Active" : "Not set"}
          </Badge>
        </div>

        <Separator />

        {/* Magic Link */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">Magic Link</p>
              <p className="text-sm text-muted-foreground">
                Sign in via email link
              </p>
            </div>
          </div>
          <Badge variant="default">Available</Badge>
        </div>

        <Separator />

        {/* Google */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <GoogleIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">Google</p>
              <p className="text-sm text-muted-foreground">
                {isGoogleLinked ? "Linked to your account" : "Not linked"}
              </p>
            </div>
          </div>
          {isGoogleLinked ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUnlink("google")}
              disabled={unlinkingProvider !== null}
            >
              {unlinkingProvider === "google" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Unlink className="mr-2 h-4 w-4" />
              )}
              Unlink
            </Button>
          ) : (
            <Badge variant="outline">Not linked</Badge>
          )}
        </div>

        <Separator />

        {/* GitHub */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Github className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium">GitHub</p>
              <p className="text-sm text-muted-foreground">
                {isGitHubLinked ? "Linked to your account" : "Not linked"}
              </p>
            </div>
          </div>
          {isGitHubLinked ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUnlink("github")}
              disabled={unlinkingProvider !== null}
            >
              {unlinkingProvider === "github" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Unlink className="mr-2 h-4 w-4" />
              )}
              Unlink
            </Button>
          ) : (
            <Badge variant="outline">Not linked</Badge>
          )}
        </div>

        {/* Link new accounts section */}
        {(!isGoogleLinked || !isGitHubLinked) && (
          <>
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-medium">Link additional accounts</p>
              <p className="text-xs text-muted-foreground">
                Link your social accounts for easier sign-in
              </p>
              <OAuthButtons mode="link" onSuccess={() => router.refresh()} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
