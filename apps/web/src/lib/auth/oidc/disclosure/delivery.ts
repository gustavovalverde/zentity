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
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireBrowserSession } from "@/lib/auth/api-auth";
import {
  extractIdentityScopes,
  filterIdentityByScopes,
} from "./registry";
import {
  oauth2IdentityLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
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

// ---------------------------------------------------------------------------
// HTTP route handlers
// ---------------------------------------------------------------------------

interface IdentityIntentInput {
  authorizedScopes: string[];
  authReqId?: string;
  clientId: string;
  scopes: string[];
}

interface IdentityStageInput {
  authorizedScopes: string[];
  authReqId?: string;
  clientId: string;
  identity: Record<string, unknown> | undefined;
  intentToken: string | undefined;
  oauthRequestKey?: string | undefined;
  scopes: string[];
}

interface ValidatedIdentityStage {
  authReqId?: string | undefined;
  clientId: string;
  filteredIdentity: Record<string, unknown>;
  identityScopes: string[];
  intentJti: string;
  oauthRequestKey?: string | undefined;
  scopeHash: string;
  scopes: string[];
  userId: string;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function validateScopeSubset(
  submitted: string[],
  authorized: string[]
): Response | null {
  const authorizedSet = new Set(authorized);
  for (const scope of submitted) {
    if (!authorizedSet.has(scope)) {
      return jsonError(`Scope not authorized: ${scope}`, 400);
    }
  }
  return null;
}

async function resolveSessionAndBody(
  request: Request
): Promise<{ userId: string; body: unknown } | Response> {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = oauth2IdentityLimiter.check(
    authResult.session.user.id
  );
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  return { userId: authResult.session.user.id, body };
}

export async function handleIdentityIntent(
  request: Request,
  resolveContext: (
    body: unknown,
    userId: string
  ) => Promise<IdentityIntentInput | Response>
): Promise<Response> {
  const sessionResult = await resolveSessionAndBody(request);
  if (sessionResult instanceof Response) {
    return sessionResult;
  }
  const { userId, body } = sessionResult;

  const ctx = await resolveContext(body, userId);
  if (ctx instanceof Response) {
    return ctx;
  }

  const scopeError = validateScopeSubset(ctx.scopes, ctx.authorizedScopes);
  if (scopeError) {
    return scopeError;
  }

  if (extractIdentityScopes(ctx.scopes).length === 0) {
    return jsonError("At least one identity scope is required", 400);
  }

  const intent = await createIdentityIntentToken({
    userId,
    clientId: ctx.clientId,
    scopes: ctx.scopes,
    ...(ctx.authReqId ? { authReqId: ctx.authReqId } : {}),
  });

  return NextResponse.json({
    intent_token: intent.intentToken,
    expires_at: intent.expiresAt,
  });
}

export async function handleIdentityStage(
  request: Request,
  resolveContext: (
    body: unknown,
    userId: string
  ) => Promise<IdentityStageInput | Response>,
  persist: (validated: ValidatedIdentityStage) => Promise<Response>
): Promise<Response> {
  const sessionResult = await resolveSessionAndBody(request);
  if (sessionResult instanceof Response) {
    return sessionResult;
  }
  const { userId, body } = sessionResult;

  const ctx = await resolveContext(body, userId);
  if (ctx instanceof Response) {
    return ctx;
  }

  const scopeError = validateScopeSubset(ctx.scopes, ctx.authorizedScopes);
  if (scopeError) {
    return scopeError;
  }

  const identityScopes = extractIdentityScopes(ctx.scopes);
  if (identityScopes.length === 0) {
    return NextResponse.json({ staged: false });
  }

  if (!ctx.intentToken) {
    return jsonError("Missing intent_token for identity scopes", 400);
  }

  let intentPayload: Awaited<ReturnType<typeof verifyIdentityIntentToken>>;
  try {
    intentPayload = await verifyIdentityIntentToken(ctx.intentToken);
  } catch {
    return jsonError("Invalid or expired intent token", 400);
  }

  if (intentPayload.userId !== userId) {
    return jsonError("Intent token does not match current user", 403);
  }

  if (ctx.authReqId && intentPayload.authReqId !== ctx.authReqId) {
    return jsonError(
      "Intent token was issued for a different auth_req_id",
      400
    );
  }

  const scopeHash = createScopeHash(ctx.scopes);
  if (
    intentPayload.clientId !== ctx.clientId ||
    intentPayload.scopeHash !== scopeHash
  ) {
    return jsonError("Intent token does not match request context", 400);
  }

  const normalizedIdentity = normalizeIdentityFields(ctx.identity ?? {});
  const filteredIdentity = filterIdentityByScopes(
    normalizedIdentity,
    identityScopes
  );

  if (Object.keys(filteredIdentity).length === 0) {
    return NextResponse.json({ staged: false });
  }

  return persist({
    userId,
    filteredIdentity,
    scopes: ctx.scopes,
    identityScopes,
    clientId: ctx.clientId,
    scopeHash,
    intentJti: intentPayload.jti,
    authReqId: ctx.authReqId,
    oauthRequestKey: ctx.oauthRequestKey,
  });
}

export async function handleIdentityUnstage(
  request: Request,
  resolveContext: (
    body: unknown,
    userId: string
  ) => Promise<unknown | Response>,
  clear: (context: unknown) => Promise<void>
): Promise<Response> {
  const sessionResult = await resolveSessionAndBody(request);
  if (sessionResult instanceof Response) {
    return sessionResult;
  }
  const { userId, body } = sessionResult;

  const result = await resolveContext(body, userId);
  if (result instanceof Response) {
    return result;
  }

  await clear(result);
  return NextResponse.json({ cleared: true });
}
