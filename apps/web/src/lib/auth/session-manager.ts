"use client";

import type { QueryClient } from "@tanstack/react-query";

import { signOut as betterAuthSignOut } from "@/lib/auth/auth-client";
import { resetFheKeyStoreCache } from "@/lib/crypto/fhe-key-store";
import { resetProfileSecretCache } from "@/lib/crypto/profile-secret";
import { resetOnboardingFlowId } from "@/lib/observability/flow-client";
import { clearOnboardingDraft } from "@/lib/onboarding/wizard-storage";

/**
 * Cookie names to clear during session transitions.
 * These are set by Better Auth and onboarding flows.
 */
const SESSION_COOKIES = [
  "better-auth.session_token",
  "better-auth.session_data",
  "zentity-wizard",
] as const;

/**
 * Clear all client-side caches.
 * Call this during sign-out and before sign-in to ensure clean state
 * when users switch on shared browsers.
 */
export function clearClientCaches(): void {
  // Clear module-level crypto caches
  resetFheKeyStoreCache();
  resetProfileSecretCache();

  // Clear localStorage (onboarding draft)
  clearOnboardingDraft();

  // Clear sessionStorage (flow ID)
  resetOnboardingFlowId();
}

/**
 * Clear all session cookies.
 * Must be called from client-side code.
 */
export function clearSessionCookies(): void {
  if (typeof document === "undefined") {
    return;
  }

  for (const name of SESSION_COOKIES) {
    // Clear with various path combinations to ensure removal
    // biome-ignore lint/suspicious/noDocumentCookie: Intentional cookie clearing for session isolation
    document.cookie = `${name}=; Max-Age=0; Path=/`;
    // biome-ignore lint/suspicious/noDocumentCookie: Intentional cookie clearing for session isolation
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

/**
 * Clear React Query cache.
 * Must be called with the queryClient instance.
 */
export function clearQueryCache(queryClient: QueryClient): void {
  queryClient.clear();
}

export interface CompleteSignOutOptions {
  /** React Query client to clear cached queries */
  queryClient?: QueryClient;
  /** Callback to clear PRF output from PasskeyAuthContext */
  onClearPrf?: () => void;
  /** URL to redirect to after sign-out (default: "/") */
  redirectTo?: string;
}

/**
 * Complete sign-out with full cache clearing.
 *
 * Order of operations:
 * 1. Clear client caches (synchronous, immediate)
 * 2. Clear React Query cache if provided
 * 3. Call PRF output clear callback (from PasskeyAuthProvider)
 * 4. Call Better Auth signOut (invalidates server session)
 * 5. Clear cookies (ensures no stale cache)
 * 6. Redirect to home
 */
export async function completeSignOut(
  options: CompleteSignOutOptions = {}
): Promise<void> {
  const { queryClient, onClearPrf, redirectTo = "/" } = options;

  // 1. Clear client-side caches immediately
  clearClientCaches();

  // 2. Clear React Query cache if provided
  if (queryClient) {
    clearQueryCache(queryClient);
  }

  // 3. Call PRF output clear callback (from PasskeyAuthProvider)
  onClearPrf?.();

  // 4. Sign out via Better Auth (this clears server session)
  await betterAuthSignOut();

  // 5. Clear cookies (including session_data cache)
  clearSessionCookies();

  // 6. Redirect
  window.location.assign(redirectTo);
}

/**
 * Prepare for a new session.
 * Call this BEFORE creating a new session to ensure clean state.
 * Handles the case where previous session wasn't properly terminated
 * (browser crash, tab close, etc.).
 */
export function prepareForNewSession(): void {
  clearClientCaches();
  clearSessionCookies();
}
