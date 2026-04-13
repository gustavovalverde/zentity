import "server-only";

/**
 * Identity Delivery Pipeline: intent token, staging, and single-consume.
 *
 * The complete PII delivery flow for OIDC verified_claims reads top-to-bottom:
 * 1. `createIdentityIntentToken` / `verifyIdentityIntentToken`: signed intent
 *    tokens bind a user + client + scope hash so the staging endpoint can
 *    verify the intent was issued by this server for this context.
 * 2. Ephemeral store: in-memory Map keyed by binding key (e.g. OAuth request
 *    or release ID). TTL is 5 min for OAuth, 10 min for CIBA. PII never hits
 *    the database; it's delivered via id_token / userinfo and then dropped.
 * 3. HTTP handlers (`handleIdentityIntent` / `handleIdentityStage` /
 *    `handleIdentityUnstage`): shared route logic across /oauth2/identity/*
 *    and /ciba/identity/*.
 */
import type { IdentityFields } from "./registry";

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { z } from "zod";

import { logger as rootLogger } from "@/lib/logging/logger";
import { getIdentityIntentKey } from "@/lib/privacy/primitives/derived-keys";

// ---------------------------------------------------------------------------
// Identity field schema + normalization (staging request validation)
// ---------------------------------------------------------------------------

const IdentityAddressSchema = z
  .object({
    formatted: z.string().optional(),
    street_address: z.string().optional(),
    locality: z.string().optional(),
    region: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
  })
  .strict();

export const IdentityFieldsSchema = z
  .object({
    given_name: z.string().optional(),
    family_name: z.string().optional(),
    name: z.string().optional(),
    birthdate: z.string().optional(),
    address: IdentityAddressSchema.optional(),
    document_number: z.string().optional(),
    document_type: z.string().optional(),
    issuing_country: z.string().optional(),
    nationality: z.string().optional(),
    nationalities: z.array(z.string()).optional(),
  })
  .strict();

export function normalizeIdentityFields(
  identity: Partial<IdentityFields>
): Partial<IdentityFields> {
  const normalized: Partial<IdentityFields> = {};

  const setIfNonEmpty = (key: keyof IdentityFields, value?: string) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        normalized[key] = trimmed as never;
      }
    }
  };

  setIfNonEmpty("given_name", identity.given_name);
  setIfNonEmpty("family_name", identity.family_name);
  setIfNonEmpty("name", identity.name);
  setIfNonEmpty("birthdate", identity.birthdate);
  setIfNonEmpty("document_number", identity.document_number);
  setIfNonEmpty("document_type", identity.document_type);
  setIfNonEmpty("issuing_country", identity.issuing_country);
  setIfNonEmpty("nationality", identity.nationality);

  if (Array.isArray(identity.nationalities)) {
    const filtered = identity.nationalities
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (filtered.length > 0) {
      normalized.nationalities = filtered;
    }
  }

  if (identity.address) {
    const address = {
      formatted: identity.address.formatted?.trim(),
      street_address: identity.address.street_address?.trim(),
      locality: identity.address.locality?.trim(),
      region: identity.address.region?.trim(),
      postal_code: identity.address.postal_code?.trim(),
      country: identity.address.country?.trim(),
    };
    const entries = Object.entries(address).filter(
      ([, value]) => typeof value === "string" && value.length > 0
    );
    if (entries.length > 0) {
      normalized.address = Object.fromEntries(entries);
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Intent tokens (signed, bound to user + client + scope hash)
// ---------------------------------------------------------------------------

const IDENTITY_INTENT_TTL_SECONDS = 120;

const IntentPayloadSchema = z.object({
  jti: z.string().min(1),
  userId: z.string().min(1),
  clientId: z.string().min(1),
  authReqId: z.string().min(1).optional(),
  scopeHash: z.string().length(64),
  exp: z.number().int().positive(),
});

interface IdentityIntentPayload {
  authReqId?: string | undefined;
  clientId: string;
  exp: number;
  jti: string;
  scopeHash: string;
  userId: string;
}

function normalizeScopes(scopes: string[]): string[] {
  return [
    ...new Set(scopes.map((scope) => scope.trim()).filter(Boolean)),
  ].sort();
}

export function createScopeHash(scopes: string[]): string {
  const normalized = normalizeScopes(scopes);
  return createHash("sha256").update(normalized.join(" ")).digest("hex");
}

export async function createIdentityIntentToken(input: {
  userId: string;
  clientId: string;
  authReqId?: string;
  scopes: string[];
  ttlSeconds?: number;
}): Promise<{
  intentToken: string;
  expiresAt: number;
  jti: string;
  scopeHash: string;
}> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (input.ttlSeconds ?? IDENTITY_INTENT_TTL_SECONDS);
  const jti = randomUUID();
  const scopeHash = createScopeHash(input.scopes);
  const payload: IdentityIntentPayload = {
    jti,
    userId: input.userId,
    clientId: input.clientId,
    ...(input.authReqId ? { authReqId: input.authReqId } : {}),
    scopeHash,
    exp: expiresAt,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = await makeSignature(encodedPayload, getIdentityIntentKey());

  return {
    intentToken: `${encodedPayload}.${signature}`,
    expiresAt,
    jti,
    scopeHash,
  };
}

export async function verifyIdentityIntentToken(
  intentToken: string
): Promise<IdentityIntentPayload> {
  const [encodedPayload, signature, extra] = intentToken.split(".");
  if (!(encodedPayload && signature) || extra) {
    throw new Error("invalid_intent_token");
  }

  const expectedSignature = await makeSignature(
    encodedPayload,
    getIdentityIntentKey()
  );
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new Error("invalid_intent_token");
  }

  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );
  } catch {
    throw new Error("invalid_intent_token");
  }

  const parsedPayload = IntentPayloadSchema.safeParse(payloadRaw);
  if (!parsedPayload.success) {
    throw new Error("invalid_intent_token");
  }

  if (parsedPayload.data.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("expired_intent_token");
  }

  return parsedPayload.data;
}

// ---------------------------------------------------------------------------
// Ephemeral in-memory PII store (single-consume, TTL-bounded)
// ---------------------------------------------------------------------------

interface IdentityPayloadMeta {
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
