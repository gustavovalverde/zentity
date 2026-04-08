import "server-only";

import type {
  ClaimsRequest,
  ParsedClaimsParameter,
} from "@/lib/auth/oidc/claims-parameter";
import type { IdentityFields } from "@/lib/auth/oidc/disclosure-registry";

import { eq, lt } from "drizzle-orm";

import { parseClaimsParameter } from "@/lib/auth/oidc/claims-parameter";
import {
  CIBA_EPHEMERAL_TTL_MS,
  clearIdentityPayload,
  consumeIdentityPayload,
  EPHEMERAL_TTL_MS,
  finalReleaseIdentityKey,
  hasIdentityPayload,
  pendingOAuthIdentityKey,
  promoteIdentityPayload,
  storeIdentityPayload,
} from "@/lib/auth/oidc/ephemeral-identity-claims";
import { computeOAuthRequestKey } from "@/lib/auth/oidc/oauth-query";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { usedIntentJtis } from "@/lib/db/schema/crypto";
import {
  oauthPendingDisclosures,
  oidcReleaseContexts,
} from "@/lib/db/schema/oauth-provider";
import { logger as rootLogger } from "@/lib/logging/logger";

const log = rootLogger.child({ component: "disclosure-context" });

export const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

export type ReleaseFlowType = "oauth" | "ciba";

interface PendingOauthDisclosure {
  approvedIdentityScopes: string[];
  clientId: string;
  expiresAt: number;
  intentJti: string;
  oauthRequestKey: string;
  scopeHash: string;
  userId: string;
}

export interface ReleaseContext {
  approvedIdentityScopes: string[];
  claimsRequest: ParsedClaimsParameter | null;
  clientId: string;
  expectsIdentityPayload: boolean;
  expiresAt: number;
  flowType: ReleaseFlowType;
  releaseId: string;
  scopeHash: string | null;
  userId: string;
}

export class DisclosureBindingError extends Error {
  oauthError: "invalid_grant" | "invalid_token";
  reason: string;

  constructor(oauthError: "invalid_grant" | "invalid_token", reason: string) {
    super(reason);
    this.name = "DisclosureBindingError";
    this.oauthError = oauthError;
    this.reason = reason;
  }
}

function serializeClaimsRequest(
  claimsRequest: ParsedClaimsParameter | null
): string | null {
  return claimsRequest ? JSON.stringify(claimsRequest) : null;
}

function deserializeClaimsRequest(
  raw: string | null | undefined
): ParsedClaimsParameter | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ParsedClaimsParameter;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function serializeStringArray(values: string[] | null): string | null {
  return values ? JSON.stringify(values) : null;
}

async function cleanupExpiredIntentJtis(): Promise<void> {
  try {
    await db
      .delete(usedIntentJtis)
      .where(lt(usedIntentJtis.expiresAt, Date.now()))
      .run();
  } catch {
    // Stale rows are harmless.
  }
}

async function isIntentJtiUsed(jti: string): Promise<boolean> {
  const row = await db
    .select({ jti: usedIntentJtis.jti })
    .from(usedIntentJtis)
    .where(eq(usedIntentJtis.jti, jti))
    .limit(1)
    .get();
  return row !== undefined;
}

async function markIntentJtiUsed(
  jti: string,
  userId: string,
  expiresAt: number
): Promise<boolean> {
  const result = await db
    .insert(usedIntentJtis)
    .values({ jti, userId, expiresAt })
    .onConflictDoNothing()
    .run();
  return (result.rowsAffected ?? 0) > 0;
}

async function cleanupExpiredPendingOauthDisclosures(): Promise<void> {
  await db
    .delete(oauthPendingDisclosures)
    .where(lt(oauthPendingDisclosures.expiresAt, new Date()))
    .run();
}

async function cleanupExpiredReleaseContexts(): Promise<void> {
  await db
    .delete(oidcReleaseContexts)
    .where(lt(oidcReleaseContexts.expiresAt, new Date()))
    .run();
}

function toReleaseContext(
  row:
    | {
        approvedIdentityScopes: string | null;
        claimsRequest: string | null;
        clientId: string;
        expectsIdentityPayload: boolean;
        expiresAt: Date | number;
        flowType: string;
        releaseId: string;
        scopeHash: string | null;
        userId: string;
      }
    | undefined
): ReleaseContext | null {
  if (!row) {
    return null;
  }

  const expiresAt =
    row.expiresAt instanceof Date ? row.expiresAt.getTime() : row.expiresAt;
  if (expiresAt <= Date.now()) {
    return null;
  }

  return {
    releaseId: row.releaseId,
    flowType: row.flowType as ReleaseFlowType,
    userId: row.userId,
    clientId: row.clientId,
    claimsRequest: deserializeClaimsRequest(row.claimsRequest),
    approvedIdentityScopes: parseStoredStringArray(row.approvedIdentityScopes),
    scopeHash: row.scopeHash,
    expectsIdentityPayload: row.expectsIdentityPayload,
    expiresAt,
  };
}

function toPendingOauthDisclosure(
  row:
    | {
        approvedIdentityScopes: string;
        clientId: string;
        expiresAt: Date | number;
        intentJti: string;
        oauthRequestKey: string;
        scopeHash: string;
        userId: string;
      }
    | undefined
): PendingOauthDisclosure | null {
  if (!row) {
    return null;
  }
  const expiresAt =
    row.expiresAt instanceof Date ? row.expiresAt.getTime() : row.expiresAt;
  if (expiresAt <= Date.now()) {
    return null;
  }
  return {
    oauthRequestKey: row.oauthRequestKey,
    userId: row.userId,
    clientId: row.clientId,
    approvedIdentityScopes: parseStoredStringArray(row.approvedIdentityScopes),
    scopeHash: row.scopeHash,
    intentJti: row.intentJti,
    expiresAt,
  };
}

async function getPendingOauthDisclosure(
  oauthRequestKey: string
): Promise<PendingOauthDisclosure | null> {
  await cleanupExpiredPendingOauthDisclosures();
  return toPendingOauthDisclosure(
    await db
      .select({
        oauthRequestKey: oauthPendingDisclosures.oauthRequestKey,
        userId: oauthPendingDisclosures.userId,
        clientId: oauthPendingDisclosures.clientId,
        approvedIdentityScopes: oauthPendingDisclosures.approvedIdentityScopes,
        scopeHash: oauthPendingDisclosures.scopeHash,
        intentJti: oauthPendingDisclosures.intentJti,
        expiresAt: oauthPendingDisclosures.expiresAt,
      })
      .from(oauthPendingDisclosures)
      .where(eq(oauthPendingDisclosures.oauthRequestKey, oauthRequestKey))
      .limit(1)
      .get()
  );
}

function releaseContextNeedsBinding(
  claimsRequest: ParsedClaimsParameter | null,
  pending: PendingOauthDisclosure | null
): boolean {
  return Boolean(pending || claimsRequest?.id_token || claimsRequest?.userinfo);
}

function releaseExpiresAt(now = Date.now()): number {
  return now + ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000;
}

function getPendingDisclosureExpiry(now = Date.now()): number {
  return now + EPHEMERAL_TTL_MS;
}

export async function stagePendingOauthDisclosure(input: {
  clientId: string;
  claims: Partial<IdentityFields>;
  scopes: string[];
  scopeHash: string;
  intentJti: string;
  oauthRequestKey: string;
  userId: string;
}): Promise<
  { ok: true } | { ok: false; reason: "intent_reused" | "concurrent_stage" }
> {
  await cleanupExpiredIntentJtis();
  await cleanupExpiredPendingOauthDisclosures();

  if (await isIntentJtiUsed(input.intentJti)) {
    return { ok: false, reason: "intent_reused" };
  }

  const payloadKey = pendingOAuthIdentityKey(input.oauthRequestKey);
  if (
    (await getPendingOauthDisclosure(input.oauthRequestKey)) ||
    hasIdentityPayload(payloadKey)
  ) {
    return { ok: false, reason: "concurrent_stage" };
  }

  const now = Date.now();
  const expiresAt = getPendingDisclosureExpiry(now);
  const payloadResult = storeIdentityPayload({
    bindingKey: payloadKey,
    claims: input.claims,
    scopes: input.scopes,
    meta: {
      clientId: input.clientId,
      intentJti: input.intentJti,
      scopeHash: input.scopeHash,
    },
    ttlMs: EPHEMERAL_TTL_MS,
  });
  if (!payloadResult.ok) {
    return payloadResult;
  }

  try {
    const insertResult = await db
      .insert(oauthPendingDisclosures)
      .values({
        oauthRequestKey: input.oauthRequestKey,
        userId: input.userId,
        clientId: input.clientId,
        approvedIdentityScopes: JSON.stringify(input.scopes),
        scopeHash: input.scopeHash,
        intentJti: input.intentJti,
        expiresAt: new Date(expiresAt),
      })
      .onConflictDoNothing()
      .run();

    if ((insertResult.rowsAffected ?? 0) === 0) {
      clearIdentityPayload(payloadKey);
      return (await isIntentJtiUsed(input.intentJti))
        ? { ok: false, reason: "intent_reused" }
        : { ok: false, reason: "concurrent_stage" };
    }

    const marked = await markIntentJtiUsed(
      input.intentJti,
      input.userId,
      expiresAt
    );
    if (!marked) {
      clearIdentityPayload(payloadKey);
      await db
        .delete(oauthPendingDisclosures)
        .where(
          eq(oauthPendingDisclosures.oauthRequestKey, input.oauthRequestKey)
        )
        .run();
      return { ok: false, reason: "intent_reused" };
    }
  } catch (err) {
    log.error(
      {
        event: "pending_oauth_stage_failed",
        userId: input.userId,
        clientId: input.clientId,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to atomically mark intent JTI — rolling back staged disclosure"
    );
    clearIdentityPayload(payloadKey);
    await db
      .delete(oauthPendingDisclosures)
      .where(eq(oauthPendingDisclosures.oauthRequestKey, input.oauthRequestKey))
      .run();
    throw new DisclosureBindingError(
      "invalid_grant",
      "pending_oauth_stage_failed"
    );
  }

  return { ok: true };
}

export async function clearPendingOauthDisclosure(
  oauthRequestKey: string
): Promise<void> {
  clearIdentityPayload(pendingOAuthIdentityKey(oauthRequestKey));
  await db
    .delete(oauthPendingDisclosures)
    .where(eq(oauthPendingDisclosures.oauthRequestKey, oauthRequestKey))
    .run();
}

export async function finalizeOauthDisclosureFromVerification(input: {
  query: Record<string, unknown>;
  referenceId?: string;
  userId: string;
}): Promise<ReleaseContext | null> {
  await cleanupExpiredPendingOauthDisclosures();
  await cleanupExpiredReleaseContexts();

  const claimsRequest = parseClaimsParameter(input.query.claims);
  const oauthRequestKey = computeOAuthRequestKey(input.query);
  const pending = await getPendingOauthDisclosure(oauthRequestKey);
  const needsBinding = releaseContextNeedsBinding(claimsRequest, pending);
  if (!needsBinding) {
    return null;
  }

  const referenceId = input.referenceId;
  const clientId =
    typeof input.query.client_id === "string" ? input.query.client_id : null;
  if (!(referenceId && clientId)) {
    log.error(
      {
        event: "oauth_binding_metadata_missing",
        userId: input.userId,
        hasReferenceId: Boolean(referenceId),
        hasClientId: Boolean(clientId),
        hasPending: Boolean(pending),
      },
      "Token exchange missing referenceId or clientId — identity disclosure cannot be bound (is postLogin.consentReferenceId configured?)"
    );
    throw new DisclosureBindingError(
      "invalid_grant",
      "oauth_binding_metadata_missing"
    );
  }

  if (
    pending &&
    !hasIdentityPayload(pendingOAuthIdentityKey(oauthRequestKey))
  ) {
    log.error(
      {
        event: "oauth_identity_payload_missing",
        userId: input.userId,
        clientId,
        referenceId,
      },
      "Pending disclosure exists in DB but ephemeral payload not found in memory (TTL expired or different process instance)"
    );
    throw new DisclosureBindingError(
      "invalid_grant",
      "oauth_identity_payload_missing"
    );
  }

  const expiresAt = releaseExpiresAt();
  await db
    .insert(oidcReleaseContexts)
    .values({
      releaseId: referenceId,
      flowType: "oauth",
      userId: input.userId,
      clientId,
      claimsRequest: serializeClaimsRequest(claimsRequest),
      approvedIdentityScopes: serializeStringArray(
        pending ? pending.approvedIdentityScopes : null
      ),
      scopeHash: pending?.scopeHash ?? null,
      expectsIdentityPayload: Boolean(pending),
      expiresAt: new Date(expiresAt),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: oidcReleaseContexts.releaseId,
      set: {
        clientId,
        claimsRequest: serializeClaimsRequest(claimsRequest),
        approvedIdentityScopes: serializeStringArray(
          pending ? pending.approvedIdentityScopes : null
        ),
        scopeHash: pending?.scopeHash ?? null,
        expectsIdentityPayload: Boolean(pending),
        expiresAt: new Date(expiresAt),
        updatedAt: new Date(),
      },
    })
    .run();

  if (pending) {
    const promoted = promoteIdentityPayload(
      pendingOAuthIdentityKey(oauthRequestKey),
      finalReleaseIdentityKey(referenceId)
    );
    if (!promoted.ok) {
      log.error(
        {
          event: "oauth_payload_promote_failed",
          reason: promoted.reason,
          userId: input.userId,
          clientId,
          referenceId,
        },
        "Failed to promote ephemeral identity payload from pending to release"
      );
      throw new DisclosureBindingError(
        "invalid_grant",
        promoted.reason === "missing_source"
          ? "oauth_identity_payload_missing"
          : "oauth_identity_payload_conflict"
      );
    }
    await db
      .delete(oauthPendingDisclosures)
      .where(eq(oauthPendingDisclosures.oauthRequestKey, oauthRequestKey))
      .run();
  }

  return loadReleaseContext(referenceId);
}

export async function stageFinalCibaDisclosure(input: {
  clientId: string;
  claims: Partial<IdentityFields>;
  releaseId: string;
  scopes: string[];
  scopeHash: string;
  intentJti: string;
  userId: string;
}): Promise<
  { ok: true } | { ok: false; reason: "intent_reused" | "concurrent_stage" }
> {
  await cleanupExpiredIntentJtis();
  await cleanupExpiredReleaseContexts();

  if (await isIntentJtiUsed(input.intentJti)) {
    return { ok: false, reason: "intent_reused" };
  }

  if (
    (await loadReleaseContext(input.releaseId)) ||
    hasIdentityPayload(finalReleaseIdentityKey(input.releaseId))
  ) {
    return { ok: false, reason: "concurrent_stage" };
  }

  const expiresAt = releaseExpiresAt();
  const payloadResult = storeIdentityPayload({
    bindingKey: finalReleaseIdentityKey(input.releaseId),
    claims: input.claims,
    scopes: input.scopes,
    meta: {
      clientId: input.clientId,
      intentJti: input.intentJti,
      scopeHash: input.scopeHash,
    },
    ttlMs: CIBA_EPHEMERAL_TTL_MS,
  });
  if (!payloadResult.ok) {
    return payloadResult;
  }

  try {
    const insertResult = await db
      .insert(oidcReleaseContexts)
      .values({
        releaseId: input.releaseId,
        flowType: "ciba",
        userId: input.userId,
        clientId: input.clientId,
        claimsRequest: null,
        approvedIdentityScopes: JSON.stringify(input.scopes),
        scopeHash: input.scopeHash,
        expectsIdentityPayload: true,
        expiresAt: new Date(expiresAt),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();

    if ((insertResult.rowsAffected ?? 0) === 0) {
      clearIdentityPayload(finalReleaseIdentityKey(input.releaseId));
      return (await isIntentJtiUsed(input.intentJti))
        ? { ok: false, reason: "intent_reused" }
        : { ok: false, reason: "concurrent_stage" };
    }

    const marked = await markIntentJtiUsed(
      input.intentJti,
      input.userId,
      expiresAt
    );
    if (!marked) {
      clearIdentityPayload(finalReleaseIdentityKey(input.releaseId));
      await db
        .delete(oidcReleaseContexts)
        .where(eq(oidcReleaseContexts.releaseId, input.releaseId))
        .run();
      return { ok: false, reason: "intent_reused" };
    }
  } catch (err) {
    log.error(
      {
        event: "ciba_stage_failed",
        releaseId: input.releaseId,
        clientId: input.clientId,
        error: err instanceof Error ? err.message : String(err),
      },
      "CIBA disclosure staging failed — rolling back release context"
    );
    clearIdentityPayload(finalReleaseIdentityKey(input.releaseId));
    await db
      .delete(oidcReleaseContexts)
      .where(eq(oidcReleaseContexts.releaseId, input.releaseId))
      .run();
    throw new DisclosureBindingError("invalid_grant", "ciba_stage_failed");
  }

  return { ok: true };
}

export async function touchReleaseContext(
  releaseId: string,
  expiresAt: number
): Promise<void> {
  await db
    .update(oidcReleaseContexts)
    .set({
      expiresAt: new Date(expiresAt),
      updatedAt: new Date(),
    })
    .where(eq(oidcReleaseContexts.releaseId, releaseId))
    .run();
}

export async function loadReleaseContext(
  releaseId: string
): Promise<ReleaseContext | null> {
  await cleanupExpiredReleaseContexts();
  return toReleaseContext(
    await db
      .select({
        releaseId: oidcReleaseContexts.releaseId,
        flowType: oidcReleaseContexts.flowType,
        userId: oidcReleaseContexts.userId,
        clientId: oidcReleaseContexts.clientId,
        claimsRequest: oidcReleaseContexts.claimsRequest,
        approvedIdentityScopes: oidcReleaseContexts.approvedIdentityScopes,
        scopeHash: oidcReleaseContexts.scopeHash,
        expectsIdentityPayload: oidcReleaseContexts.expectsIdentityPayload,
        expiresAt: oidcReleaseContexts.expiresAt,
      })
      .from(oidcReleaseContexts)
      .where(eq(oidcReleaseContexts.releaseId, releaseId))
      .limit(1)
      .get()
  );
}

export async function hasReleaseContext(releaseId: string): Promise<boolean> {
  return (await loadReleaseContext(releaseId)) !== null;
}

export async function clearReleaseContext(releaseId: string): Promise<void> {
  clearIdentityPayload(finalReleaseIdentityKey(releaseId));
  await db
    .delete(oidcReleaseContexts)
    .where(eq(oidcReleaseContexts.releaseId, releaseId))
    .run();
}

export function consumeReleaseIdentityPayload(
  releaseId: string
): ReturnType<typeof consumeIdentityPayload> {
  return consumeIdentityPayload(finalReleaseIdentityKey(releaseId));
}

export function claimsRequestForEndpoint(
  claimsRequest: ParsedClaimsParameter | null,
  endpoint: "id_token" | "userinfo"
): ClaimsRequest | undefined {
  if (!claimsRequest) {
    return undefined;
  }
  return endpoint === "id_token"
    ? claimsRequest.id_token
    : claimsRequest.userinfo;
}

export async function validateReleaseContextForSubject(input: {
  clientId: string;
  releaseId: string;
  userId: string;
}): Promise<ReleaseContext> {
  const releaseContext = await loadReleaseContext(input.releaseId);
  if (!releaseContext) {
    log.warn(
      {
        event: "release_context_missing",
        releaseId: input.releaseId,
        userId: input.userId,
        clientId: input.clientId,
      },
      "Release context not found — may have expired or was never created"
    );
    throw new DisclosureBindingError(
      "invalid_token",
      "release_context_missing"
    );
  }
  if (
    releaseContext.clientId !== input.clientId ||
    releaseContext.userId !== input.userId
  ) {
    log.warn(
      {
        event: "release_context_mismatch",
        releaseId: input.releaseId,
        expectedClient: releaseContext.clientId,
        actualClient: input.clientId,
        expectedUser: releaseContext.userId,
        actualUser: input.userId,
      },
      "Release context client/user mismatch — possible token reuse across clients"
    );
    throw new DisclosureBindingError(
      "invalid_token",
      "release_context_mismatch"
    );
  }
  return releaseContext;
}
