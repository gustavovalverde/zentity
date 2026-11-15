"use client";

import type { QueryClient } from "@tanstack/react-query";

import {
  authClient,
  signOut as betterAuthSignOut,
} from "@/lib/auth/auth-client";
import { redirectTo as navigateTo } from "@/lib/auth/redirect";
import { resetFlowId } from "@/lib/observability/flow-id";
import { clearAllCredentialCaches } from "@/lib/privacy/credentials/cache";
import { resetBackgroundKeygen } from "@/lib/privacy/fhe/background-keygen";
import { resetFheKeyStoreCache } from "@/lib/privacy/fhe/key-store";
import { resetProfileSecretCache } from "@/lib/privacy/secrets/profile";

/**
 * Clear all client-side caches.
 * Call this during sign-out and before sign-in to ensure clean state
 * when users switch on shared browsers.
 */
function clearClientCaches(): void {
  resetFheKeyStoreCache();
  resetProfileSecretCache();
  clearAllCredentialCaches();
  resetBackgroundKeygen();

  resetFlowId();
}

/**
 * Clear React Query cache.
 * Must be called with the queryClient instance.
 */
function clearQueryCache(queryClient: QueryClient): void {
  queryClient.clear();
}

interface CompleteSignOutOptions {
  /** Callback to clear PRF output from PasskeyAuthContext */
  onClearPrf?: () => void;
  /** React Query client to clear cached queries */
  queryClient?: QueryClient;
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
 * 4. Call Better Auth signOut (invalidates the server session and expires
 *    its HTTP-only session cookies)
 * 5. Redirect to home
 */
export async function completeSignOut(
  options: CompleteSignOutOptions = {}
): Promise<void> {
  const { queryClient, onClearPrf, redirectTo: redirectToPath = "/" } = options;

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

  // 5. Redirect
  navigateTo(redirectToPath);
}

/**
 * Prepare for a new session.
 * Call this BEFORE creating a new session to ensure clean state.
 * Handles the case where previous session wasn't properly terminated
 * (browser crash, tab close, etc.).
 */
export function prepareForNewSession(): void {
  clearClientCaches();
}

/**
 * Ensures a session exists, creating an anonymous one if needed.
 * Used during sign-up when passkey registration requires a user context.
 */
export async function ensureAuthSession() {
  const existing = await authClient.getSession();
  if (existing.data?.user?.id) {
    return existing.data;
  }

  const anonymous = await authClient.signIn.anonymous();
  if (anonymous?.error) {
    throw new Error(
      anonymous.error.message || "Unable to start anonymous session."
    );
  }

  const updated = await authClient.getSession();
  if (!updated.data?.user?.id) {
    throw new Error("Unable to start anonymous session.");
  }
  return updated.data;
}
