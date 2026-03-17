import { AsyncLocalStorage } from "node:async_hooks";
import type { DpopKeyPair } from "./dpop.js";

export interface AuthContext {
  accessToken: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  loginHint: string;
  /** Raw DPoP proof header from the caller (HTTP relay mode only) */
  callerDpopProof?: string | undefined;
}

const authStorage = new AsyncLocalStorage<AuthContext>();
let defaultAuth: AuthContext | undefined;
let authPromise: Promise<void> | undefined;
let authFactory: (() => Promise<void>) | undefined;

export function setDefaultAuth(ctx: AuthContext | undefined): void {
  defaultAuth = ctx;
}

export function setAuthPromise(p: Promise<void>): void {
  authPromise = p;
}

/**
 * Register a factory that can re-trigger authentication.
 * Called from stdio.ts so that requireAuth() can retry on failure.
 */
export function setAuthFactory(factory: () => Promise<void>): void {
  authFactory = factory;
}

/**
 * Wait for auth bootstrap, retrying if it failed and a factory is available.
 * Tool handlers should call this instead of getAuthContext() directly.
 */
export async function requireAuth(): Promise<AuthContext> {
  if (authPromise) {
    await authPromise;
  }

  // If auth succeeded, return the context
  if (defaultAuth) {
    return defaultAuth;
  }

  // Auth failed or never ran — retry if we have a factory
  if (authFactory) {
    console.error("[auth] Retrying authentication...");
    authPromise = authFactory();
    await authPromise;
  }

  return getAuthContext();
}

export function runWithAuth<T>(ctx: AuthContext, fn: () => T): T {
  return authStorage.run(ctx, fn);
}

export function getAuthContext(): AuthContext {
  const ctx = authStorage.getStore() ?? defaultAuth;
  if (!ctx) {
    throw new Error(
      "Not authenticated — run ensureAuthenticated() first or check server logs"
    );
  }
  return ctx;
}
