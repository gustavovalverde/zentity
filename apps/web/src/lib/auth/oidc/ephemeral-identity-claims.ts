import "server-only";

import type { IdentityFields } from "./identity-scopes";

import { eq, lt } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { usedIntentJtis } from "@/lib/db/schema/crypto";
import { logger as rootLogger } from "@/lib/logging/logger";

const log = rootLogger.child({ component: "identity-release" });

export type FlowTag = "oauth" | `ciba:${string}`;

interface EphemeralClaimsMeta {
  clientId: string;
  intentJti: string;
  scopeHash: string;
}

interface EphemeralResult {
  claims: Partial<IdentityFields>;
  meta: EphemeralClaimsMeta;
  scopes: string[];
}

interface EphemeralEntry {
  claims: Partial<IdentityFields>;
  createdAt: number;
  expiresAt: number;
  meta: EphemeralClaimsMeta;
  scopes: string[];
}

const EPHEMERAL_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CIBA_EPHEMERAL_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

function storeKey(userId: string, clientId: string, flowTag: FlowTag): string {
  return `${userId}:${clientId}:${flowTag}`;
}

export async function storeEphemeralClaims(
  userId: string,
  claims: Partial<IdentityFields>,
  scopes: string[],
  meta: EphemeralClaimsMeta,
  flowTag: FlowTag,
  ttlMs: number = EPHEMERAL_TTL_MS
): Promise<
  { ok: true } | { ok: false; reason: "intent_reused" | "concurrent_stage" }
> {
  evictExpiredClaims();
  await cleanupExpiredJtis();

  if (await isJtiUsed(meta.intentJti)) {
    return { ok: false, reason: "intent_reused" };
  }

  const s = getStore();
  const key = storeKey(userId, meta.clientId, flowTag);

  const existing = s.get(key);
  if (existing) {
    return { ok: false, reason: "concurrent_stage" };
  }

  const now = Date.now();
  const expiresAt = now + ttlMs;
  s.set(key, {
    claims,
    scopes,
    createdAt: now,
    expiresAt,
    meta,
  });
  await markJtiUsed(meta.intentJti, userId, expiresAt);

  log.info(
    {
      event: "stage_success",
      userId,
      clientId: meta.clientId,
      flowTag,
      intentJti: meta.intentJti,
      ttlMs,
    },
    "identity release staged"
  );

  return { ok: true };
}

function consumeEphemeralClaims(
  userId: string,
  clientId: string,
  flowTag: FlowTag
): EphemeralResult | null {
  evictExpiredClaims();
  const s = getStore();
  const key = storeKey(userId, clientId, flowTag);
  const entry = s.get(key);
  if (!entry) {
    return null;
  }

  s.delete(key);
  return { claims: entry.claims, scopes: entry.scopes, meta: entry.meta };
}

/**
 * Two-key deterministic resolution for customUserInfoClaims.
 * If jti is present (CIBA token), try ciba:{jti} first.
 * Then fall through to oauth.
 */
export function resolveEphemeralClaims(
  userId: string,
  clientId: string,
  jti?: string
): EphemeralResult | null {
  if (jti) {
    const cibaResult = consumeEphemeralClaims(userId, clientId, `ciba:${jti}`);
    if (cibaResult) {
      log.info(
        {
          event: "consume_success",
          userId,
          clientId,
          resolvedFlowTag: `ciba:${jti}`,
          resolution: "ciba_direct",
        },
        "identity release consumed"
      );
      return cibaResult;
    }
  }

  const oauthResult = consumeEphemeralClaims(userId, clientId, "oauth");

  log.info(
    {
      event: oauthResult ? "consume_success" : "consume_miss",
      userId,
      clientId,
      resolvedFlowTag: oauthResult ? "oauth" : undefined,
      resolution: jti ? "ciba_miss_oauth_fallback" : "oauth_direct",
      found: !!oauthResult,
      ...(jti ? { cibaJtiAttempted: jti } : {}),
    },
    oauthResult ? "identity release consumed" : "identity release not found"
  );

  return oauthResult;
}

export function clearEphemeralClaims(
  userId: string,
  clientId: string,
  flowTag: FlowTag
): boolean {
  const s = getStore();
  const key = storeKey(userId, clientId, flowTag);
  return s.delete(key);
}
