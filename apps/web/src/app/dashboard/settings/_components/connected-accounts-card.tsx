"use client";

import type { SocialProviderId } from "@/lib/auth/auth-config";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SOCIAL_PROVIDERS } from "@/components/social-providers";
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { asyncHandler } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { withPasskeyConfirmation } from "@/lib/auth/passkey/client";
import { formatDate } from "@/lib/date-format";

export interface LinkedSocialAccount {
  createdAt: Date;
  /** The Better Auth account id, which `/unlink-account` takes. */
  id: string;
  providerId: string;
}

const ACCOUNT_TAB = "/dashboard/settings?tab=account";

// The `error` codes Better Auth's OAuth callback returns for a failed link.
const LINK_ERRORS: Record<string, string> = {
  account_already_linked_to_different_user:
    "That account is already linked to another Zentity account.",
  email_does_not_match:
    "That account uses a different email address than your Zentity account.",
};
const LINK_FAILED = "We couldn't link that account. Try again.";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Links and unlinks social sign-in accounts. On a passkey account the server
 * asks for a passkey confirmation first (`withPasskeyConfirmation`).
 */
export function ConnectedAccountsCard({
  accounts,
  linkError,
  providers,
}: Readonly<{
  accounts: LinkedSocialAccount[];
  /** The `error` the OAuth callback added when a link failed. */
  linkError?: string | undefined;
  providers: SocialProviderId[];
}>) {
  const router = useRouter();
  const [pending, setPending] = useState<SocialProviderId | null>(null);
  const [error, setError] = useState<string | null>(
    linkError ? (LINK_ERRORS[linkError] ?? LINK_FAILED) : null
  );

  const link = async (provider: SocialProviderId) => {
    setPending(provider);
    setError(null);
    try {
      const result = await withPasskeyConfirmation(() =>
        authClient.linkSocial({
          provider,
          callbackURL: ACCOUNT_TAB,
          errorCallbackURL: ACCOUNT_TAB,
        })
      );
      if (result.error) {
        setError(result.error.message ?? LINK_FAILED);
        setPending(null);
      }
      // Otherwise the browser is on its way to the provider.
    } catch (err) {
      setError(messageOf(err, LINK_FAILED));
      setPending(null);
    }
  };

  const unlink = async (provider: SocialProviderId, accountId: string) => {
    setPending(provider);
    setError(null);
    const failed = `We couldn't unlink your ${SOCIAL_PROVIDERS[provider].name} account. Try again.`;
    try {
      const result = await withPasskeyConfirmation(() =>
        authClient.unlinkAccount({ accountId })
      );
      if (result.error) {
        setError(result.error.message ?? failed);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(messageOf(err, failed));
    } finally {
      setPending(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Accounts</CardTitle>
        <CardDescription>
          Link your OAuth accounts for alternative sign-in methods
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <ItemGroup>
          {providers.map((provider) => {
            const { name, Icon } = SOCIAL_PROVIDERS[provider];
            const account = accounts.find(
              (candidate) => candidate.providerId === provider
            );
            return (
              <Item key={provider} variant="outline">
                <ItemMedia variant="icon">
                  <Icon className="size-4" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{name}</ItemTitle>
                  {account ? (
                    <ItemDescription>
                      Linked {formatDate(account.createdAt, "")}
                    </ItemDescription>
                  ) : null}
                </ItemContent>
                <ItemActions>
                  <Button
                    aria-label={`${account ? "Unlink" : "Link"} ${name}`}
                    disabled={pending !== null}
                    onClick={asyncHandler(() =>
                      account ? unlink(provider, account.id) : link(provider)
                    )}
                    size="sm"
                    variant={account ? "outline" : "default"}
                  >
                    {pending === provider ? <Spinner /> : null}
                    {account ? "Unlink" : "Link"}
                  </Button>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      </CardContent>
    </Card>
  );
}
