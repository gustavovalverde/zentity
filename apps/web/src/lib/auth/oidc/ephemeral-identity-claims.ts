import "server-only";

// TODO: For multi-instance deploys, back this with a short-lived DB record
// (verification table, 5min TTL, consumed on read). The in-memory Map only
// works for single-instance deployments.

import type { IdentityFields } from "./identity-scopes";

interface EphemeralEntry {
  claims: Partial<IdentityFields>;
  scopes: string[];
  expiresAt: number;
}

const EPHEMERAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

const STORE_KEY = Symbol.for("zentity.ephemeral-identity-claims");

function getStore(): Map<string, EphemeralEntry> {
  const g = globalThis as Record<symbol, Map<string, EphemeralEntry>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map();
  }
  return g[STORE_KEY];
}

function evictExpired(): void {
  const now = Date.now();
  const s = getStore();
  for (const [key, entry] of s) {
    if (entry.expiresAt <= now) {
      s.delete(key);
    }
  }
}

export function storeEphemeralClaims(
  userId: string,
  claims: Partial<IdentityFields>,
  scopes: string[]
): void {
  evictExpired();
  const s = getStore();
  s.set(userId, {
    claims,
    scopes,
    expiresAt: Date.now() + EPHEMERAL_TTL_MS,
  });
}

export function consumeEphemeralClaims(
  userId: string
): { claims: Partial<IdentityFields>; scopes: string[] } | null {
  evictExpired();
  const s = getStore();
  const entry = s.get(userId);
  if (!entry) {
    return null;
  }
  s.delete(userId);
  return { claims: entry.claims, scopes: entry.scopes };
}
