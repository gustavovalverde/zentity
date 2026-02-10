import "server-only";

import type { IdentityFields } from "./identity-scopes";

import { eq, lt } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { usedIntentJtis } from "@/lib/db/schema/crypto";

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

function getStore(): Map<string, EphemeralEntry> {
  const g = globalThis as Record<symbol, Map<string, EphemeralEntry>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map();
  }
  return g[STORE_KEY];
}

function evictExpiredClaims(): void {
  const now = Date.now();
  const s = getStore();
  for (const [key, entry] of s) {
    if (entry.expiresAt <= now) {
      s.delete(key);
    }
  }
}

async function cleanupExpiredJtis(): Promise<void> {
  try {
    await db
      .delete(usedIntentJtis)
      .where(lt(usedIntentJtis.expiresAt, Date.now()))
      .run();
  } catch {
    // Non-critical — stale rows are harmless
  }
}

async function isJtiUsed(jti: string): Promise<boolean> {
  const row = await db
    .select({ jti: usedIntentJtis.jti })
    .from(usedIntentJtis)
    .where(eq(usedIntentJtis.jti, jti))
    .limit(1)
    .get();
  return row !== undefined;
}

async function markJtiUsed(
  jti: string,
  userId: string,
  expiresAt: number
): Promise<void> {
  await db
    .insert(usedIntentJtis)
    .values({ jti, userId, expiresAt })
    .onConflictDoNothing()
    .run();
}

export async function storeEphemeralClaims(
  userId: string,
  claims: Partial<IdentityFields>,
  scopes: string[],
  meta: EphemeralClaimsMeta
): Promise<
  { ok: true } | { ok: false; reason: "intent_reused" | "concurrent_stage" }
> {
  evictExpiredClaims();
  await cleanupExpiredJtis();

  if (await isJtiUsed(meta.intentJti)) {
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
  await markJtiUsed(meta.intentJti, userId, expiresAt);
  return { ok: true };
}

export function consumeEphemeralClaims(userId: string): {
  claims: Partial<IdentityFields>;
  scopes: string[];
  meta: EphemeralClaimsMeta;
} | null {
  evictExpiredClaims();
  const s = getStore();
  const entry = s.get(userId);
  if (!entry) {
    return null;
  }

  s.delete(userId);
  return { claims: entry.claims, scopes: entry.scopes, meta: entry.meta };
}

export async function resetEphemeralIdentityClaimsStore(): Promise<void> {
  getStore().clear();
  await db.delete(usedIntentJtis).run();
}
