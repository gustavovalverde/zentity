/**
 * Step-Up Authentication: Zentity assurance tiers requested via acr_values.
 *
 * - Pure helpers: parse and evaluate acr_values
 * - Authorize endpoint hook: enforceAuthorizeAcr (PAR + direct query paths)
 * - CIBA enforcement: approval-time and token-exchange safety net
 *
 * For first-party clients (FPA), the CIBA token exchange safety net returns
 * HTTP 403 + auth_session so the client can re-authenticate via the
 * Authorization Challenge Endpoint instead of requiring a browser redirect.
 */
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { AccountTier } from "@/lib/assurance/tier";

import { randomBytes } from "node:crypto";

import { APIError, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";

import { getAccountAssurance } from "@/lib/assurance/posture";
import { hashCibaAuthReqId } from "@/lib/auth/oidc/ciba-auth-req";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { cibaRequests } from "@/lib/db/schema/ciba";
import {
  authChallengeSessions,
  haipPushedRequests,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const ACR_TIER_PATTERN = /^urn:zentity:assurance:tier-(\d)$/;
const WHITESPACE = /\s+/;
const PAR_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";
const SESSION_LIFETIME_MS = 10 * 60 * 1000;

function parseAcrValues(raw: string): string[] {
  return raw.split(WHITESPACE).filter(Boolean);
}

function extractTierFromAcr(acr: string): number | null {
  const match = ACR_TIER_PATTERN.exec(acr);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

/**
 * Find the first requested ACR that the user's tier satisfies.
 * Higher tiers satisfy lower requirements (tier-3 satisfies tier-2).
 * Returns the first satisfiable ACR URI, or null if none are satisfied.
 */
export function findSatisfiedAcr(
  acrValuesParam: string,
  userTier: AccountTier
): string | null {
  const requested = parseAcrValues(acrValuesParam);
  for (const acr of requested) {
    const requestedTier = extractTierFromAcr(acr);
    if (requestedTier !== null && userTier >= requestedTier) {
      return acr;
    }
  }
  return null;
}

/**
 * Build an OAuth error redirect URL with error, description, and state.
 */
export function buildOAuthErrorUrl(
  redirectUri: string,
  state: string | undefined,
  error: string,
  errorDescription: string
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", errorDescription);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Authorize endpoint enforcement
// ---------------------------------------------------------------------------

interface AcrRequest {
  acr_values?: string;
  redirect_uri?: string;
  state?: string;
}

function throwRedirect(url: string): never {
  throw new APIError("FOUND", undefined, new Headers({ location: url }));
}

async function findAcrRejection(
  acrValues: string,
  userId: string
): Promise<string | null> {
  const assurance = await getAccountAssurance(userId, {
    isAuthenticated: true,
  });
  if (findSatisfiedAcr(acrValues, assurance.tier)) {
    return null;
  }
  return `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${acrValues}`;
}

async function isRegisteredRedirectUri(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>,
  clientId: string,
  redirectUri: string
): Promise<boolean> {
  const client = await db
    .select({ redirectUris: oauthClients.redirectUris })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();
  return parseStoredStringArray(client?.redirectUris).includes(redirectUri);
}

/**
 * Returns the tier rejection to the client. The hook runs before the provider
 * validates the request, so the error is redirected only to a redirect_uri the
 * client registered (RFC 6749 §4.1.2.1).
 */
async function rejectAcr(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>,
  clientId: string,
  params: AcrRequest,
  description: string
): Promise<never> {
  if (
    !(
      params.redirect_uri &&
      (await isRegisteredRedirectUri(db, clientId, params.redirect_uri))
    )
  ) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: "redirect_uri is missing or not registered",
    });
  }
  throwRedirect(
    buildOAuthErrorUrl(
      params.redirect_uri,
      params.state,
      "interaction_required",
      description
    )
  );
}

async function enforceFromPar(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>,
  requestUri: string
) {
  const clientId =
    typeof ctx.query?.client_id === "string" ? ctx.query.client_id : undefined;
  if (!clientId) {
    return;
  }

  const requestId = requestUri.slice(PAR_URI_PREFIX.length);
  const record = await db
    .select({
      id: haipPushedRequests.id,
      requestParams: haipPushedRequests.requestParams,
      clientId: haipPushedRequests.clientId,
    })
    .from(haipPushedRequests)
    .where(eq(haipPushedRequests.requestId, requestId))
    .limit(1)
    .get();

  if (!record || record.clientId !== clientId) {
    return;
  }

  const params = JSON.parse(record.requestParams) as AcrRequest;
  if (!params.acr_values) {
    return;
  }

  const session = await getSessionFromCtx(ctx);
  if (!session) {
    return;
  }

  const rejection = await findAcrRejection(params.acr_values, session.user.id);
  if (!rejection) {
    return;
  }

  await db
    .delete(haipPushedRequests)
    .where(eq(haipPushedRequests.id, record.id))
    .run();
  await rejectAcr(db, clientId, params, rejection);
}

async function enforceFromQuery(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>
) {
  const query = ctx.query ?? {};
  const clientId =
    typeof query.client_id === "string" ? query.client_id : undefined;
  const params: AcrRequest = {
    acr_values:
      typeof query.acr_values === "string" ? query.acr_values : undefined,
    redirect_uri:
      typeof query.redirect_uri === "string" ? query.redirect_uri : undefined,
    state: typeof query.state === "string" ? query.state : undefined,
  };
  if (!(params.acr_values && clientId)) {
    return;
  }

  const session = await getSessionFromCtx(ctx);
  if (!session) {
    return;
  }

  const rejection = await findAcrRejection(params.acr_values, session.user.id);
  if (rejection) {
    await rejectAcr(db, clientId, params, rejection);
  }
}

/**
 * Enforce Zentity assurance tiers requested through `acr_values` on the
 * authorize endpoint. The provider treats `acr_values` as voluntary and owns
 * `max_age`; an unmet tier returns `interaction_required` to the client.
 */
// biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
export async function enforceAuthorizeAcr(ctx: any, db: LibSQLDatabase<any>) {
  const requestUri =
    typeof ctx.query?.request_uri === "string"
      ? ctx.query.request_uri
      : undefined;

  if (requestUri?.startsWith(PAR_URI_PREFIX)) {
    await enforceFromPar(ctx, db, requestUri);
  } else {
    await enforceFromQuery(ctx, db);
  }
}

// ---------------------------------------------------------------------------
// CIBA enforcement
// ---------------------------------------------------------------------------

async function extractDpopJkt(
  headers: Headers | undefined
): Promise<string | undefined> {
  const proof = headers?.get("DPoP");
  if (!proof) {
    return undefined;
  }
  try {
    const header = decodeProtectedHeader(proof);
    if (header.jwk) {
      return await calculateJwkThumbprint(
        header.jwk as Record<string, unknown>
      );
    }
  } catch {
    // DPoP proof parsing failed
  }
  return undefined;
}

/**
 * Check acr_values before approving a CIBA request.
 * Called from the before hook on /ciba/authorize.
 */
export async function enforceCibaApprovalAcr(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>
) {
  const authReqId =
    typeof ctx.body?.auth_req_id === "string"
      ? ctx.body.auth_req_id
      : undefined;
  if (!authReqId) {
    return;
  }

  const record = await db
    .select({ acrValues: cibaRequests.acrValues, userId: cibaRequests.userId })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
    .limit(1)
    .get();

  if (!record?.acrValues) {
    return;
  }

  const assurance = await getAccountAssurance(record.userId, {
    isAuthenticated: true,
  });
  const satisfied = findSatisfiedAcr(record.acrValues, assurance.tier);

  if (!satisfied) {
    throw new APIError("FORBIDDEN", {
      message: `Your assurance level (tier-${assurance.tier}) does not meet the required level: ${record.acrValues}`,
    });
  }
}

/**
 * Safety net: re-check acr_values at CIBA token exchange time.
 * Called from the before hook on /oauth2/token when grant_type is CIBA.
 *
 * For first-party clients: returns 403 + auth_session (FPA step-up path).
 * For other clients: returns 400 interaction_required (standard behavior).
 */
export async function enforceCibaTokenAcr(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>
) {
  const authReqId =
    typeof ctx.body?.auth_req_id === "string"
      ? ctx.body.auth_req_id
      : undefined;
  if (!authReqId) {
    return;
  }

  const record = await db
    .select({
      acrValues: cibaRequests.acrValues,
      userId: cibaRequests.userId,
      status: cibaRequests.status,
      scope: cibaRequests.scope,
      resource: cibaRequests.resource,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, hashCibaAuthReqId(authReqId)))
    .limit(1)
    .get();

  if (!record?.acrValues || record.status !== "approved") {
    return;
  }

  const assurance = await getAccountAssurance(record.userId, {
    isAuthenticated: true,
  });
  const satisfied = findSatisfiedAcr(record.acrValues, assurance.tier);

  if (!satisfied) {
    const clientId =
      typeof ctx.body?.client_id === "string" ? ctx.body.client_id : undefined;

    if (clientId) {
      const client = await db
        .select({ firstParty: oauthClients.firstParty })
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .get();

      if (client?.firstParty) {
        const authSession = randomBytes(32).toString("base64url");
        const dpopJkt = await extractDpopJkt(ctx.headers);

        await db.insert(authChallengeSessions).values({
          authSession,
          clientId,
          userId: record.userId,
          scope: record.scope,
          resource: record.resource ?? null,
          acrValues: record.acrValues,
          dpopJkt: dpopJkt ?? null,
          state: "pending",
          expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
        });

        throw new APIError("FORBIDDEN", {
          error: "insufficient_authorization",
          auth_session: authSession,
          error_description: `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${record.acrValues}`,
        });
      }
    }

    throw new APIError("BAD_REQUEST", {
      error: "interaction_required",
      error_description: `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${record.acrValues}`,
    });
  }
}
