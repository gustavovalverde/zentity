"use client";

import { useCallback, useMemo, useState } from "react";
import { authClient, signOut, useSession } from "@/lib/auth-client";
import { isMobile, openOAuthPopup } from "@/lib/oauth-popup";
import type { Scenario } from "@/lib/scenarios";

const ERROR_MESSAGES: Record<string, string> = {
  interaction_required:
    "Identity verification required. This service requires a higher assurance level than your current account provides. Please complete identity verification on Zentity first.",
};

export function useOAuthFlow(scenario: Scenario) {
  const { data: session, isPending } = useSession();
  const [oauthError, setOauthError] = useState<string | null>(null);

  const allClaims = (
    session?.user as { claims?: Record<string, Record<string, unknown>> }
  )?.claims;
  const claims = allClaims?.[scenario.providerId];

  // User is authenticated for THIS provider only if they have claims from it
  const isAuthenticated = !!claims;

  const isSteppedUp = useMemo(
    () =>
      scenario.stepUpClaimKeys.length > 0 &&
      scenario.stepUpClaimKeys.every((k) => claims?.[k] !== undefined),
    [scenario.stepUpClaimKeys, claims]
  );

  const hasStepUp = scenario.stepUpScopes.length > 0;
  const isComplete = !hasStepUp || isSteppedUp;

  const runOAuthFlow = useCallback(
    async (scopes?: string[]) => {
      setOauthError(null);
      if (!isMobile()) {
        const result = await openOAuthPopup(scenario.providerId, scopes);
        if (result.error) {
          setOauthError(
            ERROR_MESSAGES[result.error] ??
              result.errorDescription ??
              `OAuth error: ${result.error}`
          );
          return;
        }
        if (result.completed) {
          globalThis.window.location.reload();
        }
        return;
      }
      await authClient.signIn.oauth2({
        providerId: scenario.providerId,
        callbackURL: `/${scenario.id}`,
        ...(scopes?.length ? { scopes } : {}),
      });
    },
    [scenario.providerId, scenario.id]
  );

  const handleSignIn = useCallback(() => runOAuthFlow(), [runOAuthFlow]);

  const handleStepUp = useCallback(() => {
    const allScopes = [...scenario.signInScopes, ...scenario.stepUpScopes];
    return runOAuthFlow(allScopes);
  }, [runOAuthFlow, scenario.signInScopes, scenario.stepUpScopes]);

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, []);

  const dismissError = useCallback(() => setOauthError(null), []);

  return {
    session,
    isPending,
    isAuthenticated,
    claims,
    isSteppedUp,
    isComplete,
    oauthError,
    handleSignIn,
    handleStepUp,
    handleSignOut,
    dismissError,
  };
}
