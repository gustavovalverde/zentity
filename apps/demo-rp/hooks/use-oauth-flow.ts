"use client";

import { useCallback, useMemo } from "react";
import { authClient, signOut, useSession } from "@/lib/auth-client";
import { isMobile, openOAuthPopup } from "@/lib/oauth-popup";
import type { Scenario } from "@/lib/scenarios";

export function useOAuthFlow(scenario: Scenario) {
	const { data: session, isPending } = useSession();

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
		[scenario.stepUpClaimKeys, claims],
	);

	const hasStepUp = scenario.stepUpScopes.length > 0;
	const isComplete = !hasStepUp || isSteppedUp;

	const handleSignIn = useCallback(async () => {
		if (!isMobile()) {
			const completed = await openOAuthPopup(scenario.providerId);
			if (completed) {
				globalThis.window.location.reload();
			}
			return;
		}
		await authClient.signIn.oauth2({
			providerId: scenario.providerId,
			callbackURL: `/${scenario.id}`,
		});
	}, [scenario.providerId, scenario.id]);

	const handleStepUp = useCallback(async () => {
		const allScopes = [...scenario.signInScopes, ...scenario.stepUpScopes];
		if (!isMobile()) {
			const completed = await openOAuthPopup(scenario.providerId, allScopes);
			if (completed) {
				globalThis.window.location.reload();
			}
			return;
		}
		await authClient.signIn.oauth2({
			providerId: scenario.providerId,
			callbackURL: `/${scenario.id}`,
			scopes: allScopes,
		});
	}, [
		scenario.providerId,
		scenario.id,
		scenario.signInScopes,
		scenario.stepUpScopes,
	]);

	const handleSignOut = useCallback(async () => {
		await signOut();
	}, []);

	return {
		session,
		isPending,
		isAuthenticated,
		claims,
		isSteppedUp,
		isComplete,
		handleSignIn,
		handleStepUp,
		handleSignOut,
	};
}
