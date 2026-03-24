import "server-only";

import type { IdentityFields } from "./identity-scopes";

import { logger as rootLogger } from "@/lib/logging/logger";

export interface IdentityPayloadMeta {
  clientId: string;
  intentJti: string;
  scopeHash: string;
}

interface IdentityPayloadResult {
  claims: Partial<IdentityFields>;
  meta: IdentityPayloadMeta;
  scopes: string[];
}

interface IdentityPayloadEntry {
  claims: Partial<IdentityFields>;
  createdAt: number;
  expiresAt: number;
  meta: IdentityPayloadMeta;
  scopes: string[];
}

const log = rootLogger.child({ component: "identity-release" });

export const EPHEMERAL_TTL_MS = 5 * 60 * 1000;
export const CIBA_EPHEMERAL_TTL_MS = 10 * 60 * 1000;

const STORE_KEY = Symbol.for("zentity.ephemeral-identity-claims");

function getStore(): Map<string, IdentityPayloadEntry> {
  const g = globalThis as Record<symbol, Map<string, IdentityPayloadEntry>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map();
  }
  return g[STORE_KEY];
}

export function pendingOAuthIdentityKey(oauthRequestKey: string): string {
  return `pending:oaq:${oauthRequestKey}`;
}

export function finalReleaseIdentityKey(releaseId: string): string {
  return `release:${releaseId}`;
}

function evictExpiredIdentityPayloads(): void {
  const now = Date.now();
  const s = getStore();
  for (const [key, entry] of s) {
    if (entry.expiresAt <= now) {
      s.delete(key);
    }
  }
}

export function hasIdentityPayload(bindingKey: string): boolean {
  evictExpiredIdentityPayloads();
  return getStore().has(bindingKey);
}

export function storeIdentityPayload(input: {
  bindingKey: string;
  claims: Partial<IdentityFields>;
  scopes: string[];
  meta: IdentityPayloadMeta;
  ttlMs: number;
}): { ok: true } | { ok: false; reason: "concurrent_stage" } {
  evictExpiredIdentityPayloads();

  const s = getStore();
  if (s.has(input.bindingKey)) {
    return { ok: false, reason: "concurrent_stage" };
  }

  const now = Date.now();
  s.set(input.bindingKey, {
    claims: input.claims,
    scopes: input.scopes,
    createdAt: now,
    expiresAt: now + input.ttlMs,
    meta: input.meta,
  });

  log.info(
    {
      event: "stage_success",
      bindingKey: input.bindingKey,
      clientId: input.meta.clientId,
      intentJti: input.meta.intentJti,
      ttlMs: input.ttlMs,
    },
    "identity payload staged"
  );

  return { ok: true };
}

export function consumeIdentityPayload(
  bindingKey: string
): IdentityPayloadResult | null {
  evictExpiredIdentityPayloads();

  const s = getStore();
  const entry = s.get(bindingKey);
  if (!entry) {
    return null;
  }

  s.delete(bindingKey);
  log.info(
    { event: "consume_success", bindingKey, clientId: entry.meta.clientId },
    "identity payload consumed"
  );
  return {
    claims: entry.claims,
    scopes: entry.scopes,
    meta: entry.meta,
  };
}

export function promoteIdentityPayload(
  fromBindingKey: string,
  toBindingKey: string
): { ok: true } | { ok: false; reason: "missing_source" | "target_exists" } {
  evictExpiredIdentityPayloads();

  const s = getStore();
  const entry = s.get(fromBindingKey);
  if (!entry) {
    return { ok: false, reason: "missing_source" };
  }
  if (s.has(toBindingKey)) {
    return { ok: false, reason: "target_exists" };
  }

  s.set(toBindingKey, entry);
  s.delete(fromBindingKey);

  log.info(
    {
      event: "promote_success",
      fromBindingKey,
      toBindingKey,
      clientId: entry.meta.clientId,
    },
    "identity payload promoted"
  );

  return { ok: true };
}

export function clearIdentityPayload(bindingKey: string): boolean {
  return getStore().delete(bindingKey);
}
