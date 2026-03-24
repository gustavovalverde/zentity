import { AsyncLocalStorage } from "node:async_hooks";
import type { DpopKeyPair } from "./dpop.js";
import {
  type AgentRuntimeState,
  agentRuntimeManager,
} from "./runtime-manager.js";

export interface OAuthSessionContext {
  accessToken: string;
  accountSub: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  loginHint: string;
  scopes: string[];
}

export interface AuthContext {
  oauth: OAuthSessionContext;
  runtime?: AgentRuntimeState;
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
    try {
      await authPromise;
    } catch {
      // Fall through to the retry path below.
    }
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
  const runtime = ctx.runtime ?? agentRuntimeManager.getState();
  return runtime ? { ...ctx, runtime } : ctx;
}

export function getOAuthContext(ctx?: AuthContext): OAuthSessionContext {
  return (ctx ?? getAuthContext()).oauth;
}

export function requireRuntimeState(ctx?: AuthContext): AgentRuntimeState {
  const runtime =
    (ctx ?? getAuthContext()).runtime ?? agentRuntimeManager.getState();
  if (!runtime) {
    throw new Error(
      "Agent runtime is not initialized — complete host and session registration first"
    );
  }
  return runtime;
}
