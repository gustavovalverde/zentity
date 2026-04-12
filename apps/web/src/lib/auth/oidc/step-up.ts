/**
 * Step-Up Authentication: OIDC acr_values and max_age enforcement.
 *
 * Complete step-up pipeline per OIDC Core §3.1.2.1:
 * - Pure helpers: parse and evaluate acr_values / max_age
 * - Authorize endpoint hook: enforceStepUp (PAR + direct query paths)
 * - CIBA enforcement: approval-time and token-exchange safety net
 *
 * For first-party clients (FPA), the CIBA token exchange safety net returns
 * HTTP 403 + auth_session so the client can re-authenticate via the
 * Authorization Challenge Endpoint instead of requiring a browser redirect.
 */
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { AccountTier } from "@/lib/assurance/types";

import { randomBytes } from "node:crypto";

import { APIError, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";

import { getAccountAssurance } from "@/lib/assurance/data";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
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
const MAX_AGE_REAUTH_TTL_MS = 300_000;
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
 * Check if the session age exceeds max_age seconds.
 * max_age=0 always returns true (force re-auth).
 */
export function isMaxAgeExceeded(
  sessionCreatedAt: string | Date,
  maxAge: number
): boolean {
  const authTime = Math.floor(new Date(sessionCreatedAt).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  return now - authTime >= maxAge;
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

interface StepUpParams {
  acr_values?: string;
  max_age?: string;
  prompt?: string;
  redirect_uri?: string;
  state?: string;
}

interface SessionInfo {
  createdAt: string | Date;
  userId: string;
}

type StepUpAction =
  | { type: "login_required"; description: string }
  | { type: "reauth" }
  | { type: "acr_rejected"; description: string };

function throwRedirect(url: string): never {
  throw new APIError("FOUND", undefined, new Headers({ location: url }));
}

async function evaluate(
  params: StepUpParams,
  session: SessionInfo
): Promise<StepUpAction | null> {
  const maxAgeStr = params.max_age;
  const maxAge =
    maxAgeStr === undefined ? undefined : Number.parseInt(maxAgeStr, 10);
  const maxAgeExceeded =
    maxAge !== undefined &&
    !Number.isNaN(maxAge) &&
    isMaxAgeExceeded(session.createdAt, maxAge);

  if (params.prompt === "none" && maxAgeExceeded) {
    return {
      type: "login_required",
      description:
        "Session exceeds max_age and prompt=none forbids interaction",
    };
  }

  if (maxAgeExceeded) {
    return { type: "reauth" };
  }

  if (params.acr_values) {
    const assurance = await getAccountAssurance(session.userId, {
      isAuthenticated: true,
    });
    const satisfied = findSatisfiedAcr(params.acr_values, assurance.tier);
    if (!satisfied) {
      return {
        type: "acr_rejected",
        description: `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${params.acr_values}`,
      };
    }
  }

  return null;
}

// biome-ignore lint/suspicious/noExplicitAny: query params are untyped
function extractQueryParams(query: any): StepUpParams {
  return {
    acr_values:
      typeof query?.acr_values === "string" ? query.acr_values : undefined,
    max_age: typeof query?.max_age === "string" ? query.max_age : undefined,
    prompt: typeof query?.prompt === "string" ? query.prompt : undefined,
    redirect_uri:
      typeof query?.redirect_uri === "string" ? query.redirect_uri : undefined,
    state: typeof query?.state === "string" ? query.state : undefined,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: query params are untyped
function buildAuthorizeCallback(query: any): string {
  const url = new URL("http://placeholder/api/auth/oauth2/authorize");
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
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

  const params = JSON.parse(record.requestParams) as StepUpParams;
  if (!params.acr_values && params.max_age === undefined) {
    return;
  }

  const resolved = await getSessionFromCtx(ctx);
  if (!resolved) {
    return;
  }

  const session: SessionInfo = {
    userId: resolved.user.id,
    createdAt: resolved.session.createdAt,
  };

  const action = await evaluate(params, session);
  if (!action) {
    return;
  }

  if (action.type === "login_required" && params.redirect_uri) {
    await db
      .delete(haipPushedRequests)
      .where(eq(haipPushedRequests.id, record.id))
      .run();
    throwRedirect(
      buildOAuthErrorUrl(
        params.redirect_uri,
        params.state,
        "login_required",
        action.description
      )
    );
  }

  if (action.type === "reauth") {
    await db
      .update(haipPushedRequests)
      .set({ expiresAt: new Date(Date.now() + MAX_AGE_REAUTH_TTL_MS) })
      .where(eq(haipPushedRequests.id, record.id))
      .run();
    const issuer = getAuthIssuer();
    const base = new URL(issuer).origin;
    const callbackPath = `/api/auth/oauth2/authorize?request_uri=${encodeURIComponent(requestUri)}&client_id=${encodeURIComponent(clientId)}`;
    throwRedirect(
      `${base}/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`
    );
  }

  if (action.type === "acr_rejected") {
    await db
      .delete(haipPushedRequests)
      .where(eq(haipPushedRequests.id, record.id))
      .run();
    if (!params.redirect_uri) {
      throw new APIError("BAD_REQUEST", {
        message: "interaction_required: no redirect_uri to return error",
      });
    }
    throwRedirect(
      buildOAuthErrorUrl(
        params.redirect_uri,
        params.state,
        "interaction_required",
        action.description
      )
    );
  }
}

// biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
async function enforceFromQuery(ctx: any) {
  const params = extractQueryParams(ctx.query);
  if (!params.acr_values && params.max_age === undefined) {
    return;
  }

  const resolved = await getSessionFromCtx(ctx);
  if (!resolved) {
    return;
  }

  const session: SessionInfo = {
    userId: resolved.user.id,
    createdAt: resolved.session.createdAt,
  };

  const action = await evaluate(params, session);
  if (!action) {
    return;
  }

  if (action.type === "login_required" && params.redirect_uri) {
    throwRedirect(
      buildOAuthErrorUrl(
        params.redirect_uri,
        params.state,
        "login_required",
        action.description
      )
    );
  }

  if (action.type === "reauth") {
    const issuer = getAuthIssuer();
    const base = new URL(issuer).origin;
    const callbackPath = buildAuthorizeCallback(ctx.query);
    throwRedirect(
      `${base}/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`
    );
  }

  if (action.type === "acr_rejected") {
    if (!params.redirect_uri) {
      throw new APIError("BAD_REQUEST", {
        message: "interaction_required: no redirect_uri to return error",
      });
    }
    throwRedirect(
      buildOAuthErrorUrl(
        params.redirect_uri,
        params.state,
        "interaction_required",
        action.description
      )
    );
  }
}

/**
 * Enforce acr_values and max_age on the authorize endpoint.
 * Called from the global before hook for /oauth2/authorize.
 */
// biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
export async function enforceStepUp(ctx: any, db: LibSQLDatabase<any>) {
  const requestUri =
    typeof ctx.query?.request_uri === "string"
      ? ctx.query.request_uri
      : undefined;

  if (requestUri?.startsWith(PAR_URI_PREFIX)) {
    await enforceFromPar(ctx, db, requestUri);
  } else {
    await enforceFromQuery(ctx);
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
    .where(eq(cibaRequests.authReqId, authReqId))
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
    .where(eq(cibaRequests.authReqId, authReqId))
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
