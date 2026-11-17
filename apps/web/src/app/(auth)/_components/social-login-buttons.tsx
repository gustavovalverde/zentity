"use client";

import type { SocialProviderId } from "@/lib/auth/auth-config";

import { useAuth } from "@better-auth-ui/react";
import { useState } from "react";

import { SOCIAL_PROVIDERS } from "@/components/social-providers";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { asyncHandler } from "@/lib/async-handler";
import { authClient } from "@/lib/auth/auth-client";
import { prepareForNewSession } from "@/lib/auth/session-cleanup";

function isKnownProvider(provider: unknown): provider is SocialProviderId {
  return (
    typeof provider === "string" && Object.hasOwn(SOCIAL_PROVIDERS, provider)
  );
}

export function SocialLoginButtons() {
  const { socialProviders } = useAuth();
  const providers = (socialProviders ?? []).filter(isKnownProvider);
  const [loadingProvider, setLoadingProvider] =
    useState<SocialProviderId | null>(null);

  if (providers.length === 0) {
    return null;
  }

  const handleSocialLogin = async (provider: SocialProviderId) => {
    setLoadingProvider(provider);
    prepareForNewSession();
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: "/dashboard",
        errorCallbackURL: "/sign-in",
      });
    } catch {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => {
        const { name, Icon } = SOCIAL_PROVIDERS[provider];
        return (
          <Button
            className="w-full"
            disabled={loadingProvider !== null}
            key={provider}
            onClick={asyncHandler(() => handleSocialLogin(provider))}
            variant="outline"
          >
            {loadingProvider === provider ? (
              <Spinner className="mr-2 size-4" />
            ) : (
              <Icon className="mr-2 size-4" />
            )}
            {`Continue with ${name}`}
          </Button>
        );
      })}
    </div>
  );
}
