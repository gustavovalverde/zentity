"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authClient, signOut, useSession } from "@/lib/auth-client";
import type { Scenario } from "@/lib/scenarios";

const ERROR_MESSAGES: Record<string, string> = {
  interaction_required:
    "Identity verification required. This service requires a higher assurance level than your current account provides. Please complete identity verification on Zentity first.",
};

export function useOAuthFlow(scenario: Scenario) {
  const { data: session, isPending } = useSession();
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(globalThis.window.location.search);
    const error = params.get("error");
    if (error) {
      const description = params.get("error_description");
      setOauthError(
        ERROR_MESSAGES[error] ?? description ?? `OAuth error: ${error}`
      );
      const url = new URL(globalThis.window.location.href);
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      globalThis.window.history.replaceState({}, "", url.pathname);
    }
  }, []);

  const allClaims = (
    session?.user as { claims?: Record<string, Record<string, unknown>> }
  )?.claims;
  const claims = allClaims?.[scenario.providerId];

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
