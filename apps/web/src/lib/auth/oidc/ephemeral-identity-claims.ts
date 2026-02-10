import "server-only";

// TODO: For multi-instance deploys, back this with a short-lived DB record
// (verification table, 5min TTL, consumed on read). The in-memory Map only
// works for single-instance deployments.

import type { IdentityFields } from "./identity-scopes";

export interface EphemeralClaimsMeta {
  clientId: string;
  scopeHash: string;
  intentJti: string;
}

interface EphemeralEntry {
  claims: Partial<IdentityFields>;
  scopes: string[];
  expiresAt: number;
  meta: EphemeralClaimsMeta;
}

const EPHEMERAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

const STORE_KEY = Symbol.for("zentity.ephemeral-identity-claims");
const USED_INTENTS_KEY = Symbol.for("zentity.ephemeral-identity-intents");

function getStore(): Map<string, EphemeralEntry> {
  const g = globalThis as Record<symbol, Map<string, EphemeralEntry>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map();
  }
  return g[STORE_KEY];
}

function getUsedIntentStore(): Map<string, number> {
  const g = globalThis as Record<symbol, Map<string, number>>;
  if (!g[USED_INTENTS_KEY]) {
    g[USED_INTENTS_KEY] = new Map();
  }
  return g[USED_INTENTS_KEY];
}

function evictExpired(): void {
  const now = Date.now();
  const s = getStore();
  for (const [key, entry] of s) {
    if (entry.expiresAt <= now) {
      s.delete(key);
    }
  }

  const usedIntents = getUsedIntentStore();
  for (const [intentJti, expiresAt] of usedIntents) {
    if (expiresAt <= now) {
      usedIntents.delete(intentJti);
    }
  }
}

export function storeEphemeralClaims(
  userId: string,
  claims: Partial<IdentityFields>,
  scopes: string[],
  meta: EphemeralClaimsMeta
): { ok: true } | { ok: false; reason: "intent_reused" | "concurrent_stage" } {
  evictExpired();

  const usedIntents = getUsedIntentStore();
  if (usedIntents.has(meta.intentJti)) {
    return { ok: false, reason: "intent_reused" };
  }

  const s = getStore();
  const existing = s.get(userId);
  if (existing) {
    return { ok: false, reason: "concurrent_stage" };
  }

  const expiresAt = Date.now() + EPHEMERAL_TTL_MS;
  s.set(userId, {
    claims,
    scopes,
    expiresAt,
    meta,
  });
  usedIntents.set(meta.intentJti, expiresAt);
  return { ok: true };
}

export function consumeEphemeralClaims(userId: string): {
  claims: Partial<IdentityFields>;
  scopes: string[];
  meta: EphemeralClaimsMeta;
} | null {
  evictExpired();
  const s = getStore();
  const entry = s.get(userId);
  if (!entry) {
    return null;
  }

  s.delete(userId);
  return { claims: entry.claims, scopes: entry.scopes, meta: entry.meta };
}

export function resetEphemeralIdentityClaimsStore(): void {
  getStore().clear();
  getUsedIntentStore().clear();
}
