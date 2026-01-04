"use client";

import { Github, Key, Mail, Unlink } from "lucide-react";
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/auth-client";

// Google icon component
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="currentColor"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="currentColor"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="currentColor"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="currentColor"
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
    null
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
      <CardContent>
        <ItemGroup>
          {/* Email/Password */}
          <Item>
            <ItemMedia variant="icon">
              <Mail />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Email & Password</ItemTitle>
              <ItemDescription>{email}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={hasPassword ? "default" : "outline"}>
                {hasPassword ? "Active" : "Not set"}
              </Badge>
            </ItemActions>
          </Item>

          <ItemSeparator />

          {/* Magic Link */}
          <Item>
            <ItemMedia variant="icon">
              <Mail />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Magic Link</ItemTitle>
              <ItemDescription>Sign in via email link</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="default">Available</Badge>
            </ItemActions>
          </Item>

          <ItemSeparator />

          {/* Google */}
          <Item>
            <ItemMedia variant="icon">
              <GoogleIcon className="h-5 w-5" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Google</ItemTitle>
              <ItemDescription>
                {isGoogleLinked ? "Linked to your account" : "Not linked"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              {isGoogleLinked ? (
                <Button
                  disabled={unlinkingProvider !== null}
                  onClick={() => handleUnlink("google")}
                  size="sm"
                  variant="outline"
                >
                  {unlinkingProvider === "google" ? (
                    <Spinner className="mr-2" size="sm" />
                  ) : (
                    <Unlink className="mr-2 h-4 w-4" />
                  )}
                  Unlink
                </Button>
              ) : (
                <Badge variant="outline">Not linked</Badge>
              )}
            </ItemActions>
          </Item>

          <ItemSeparator />

          {/* GitHub */}
          <Item>
            <ItemMedia variant="icon">
              <Github />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>GitHub</ItemTitle>
              <ItemDescription>
                {isGitHubLinked ? "Linked to your account" : "Not linked"}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              {isGitHubLinked ? (
                <Button
                  disabled={unlinkingProvider !== null}
                  onClick={() => handleUnlink("github")}
                  size="sm"
                  variant="outline"
                >
                  {unlinkingProvider === "github" ? (
                    <Spinner className="mr-2" size="sm" />
                  ) : (
                    <Unlink className="mr-2 h-4 w-4" />
                  )}
                  Unlink
                </Button>
              ) : (
                <Badge variant="outline">Not linked</Badge>
              )}
            </ItemActions>
          </Item>
        </ItemGroup>

        {/* Link new accounts section */}
        {!(isGoogleLinked && isGitHubLinked) && (
          <div className="mt-6 space-y-3 border-t pt-6">
            <p className="font-medium text-sm">Link additional accounts</p>
            <p className="text-muted-foreground text-xs">
              Link your social accounts for easier sign-in
            </p>
            <OAuthButtons mode="link" onSuccess={() => router.refresh()} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
