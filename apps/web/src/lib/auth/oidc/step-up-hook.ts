/**
 * Step-Up Authentication Hook — Authorize endpoint enforcement
 *
 * Enforces acr_values / max_age before the authorize endpoint runs.
 * Supports two parameter sources:
 *
 * 1. PAR-based: reads params from the PAR record (non-destructive peek).
 *    On max_age re-auth, preserves the record and extends its TTL.
 *    On acr_values failure, deletes the record.
 *
 * 2. Direct query params: reads acr_values / max_age from ctx.query.
 *    On max_age re-auth, reconstructs the authorize URL as the callback.
 *    On acr_values failure, redirects to the RP with an error.
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { APIError, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";

import { getAssuranceForOAuth } from "@/lib/assurance/data";
import { getAuthIssuer } from "@/lib/auth/issuer";
import {
  buildOAuthErrorUrl,
  findSatisfiedAcr,
  isMaxAgeExceeded,
} from "@/lib/auth/oidc/step-up";
import { haipPushedRequests } from "@/lib/db/schema/haip";

const PAR_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";
const MAX_AGE_REAUTH_TTL_MS = 300_000; // 5 min for re-auth

interface StepUpParams {
  acr_values?: string;
  max_age?: string;
  prompt?: string;
  redirect_uri?: string;
  state?: string;
}

function throwRedirect(url: string): never {
  throw new APIError("FOUND", undefined, new Headers({ location: url }));
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

// ── PAR-based enforcement ───────────────────────────────

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

// ── Direct query param enforcement ──────────────────────

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

// ── Shared helpers ──────────────────────────────────────

interface SessionInfo {
  createdAt: string | Date;
  userId: string;
}

type StepUpAction =
  | { type: "login_required"; description: string }
  | { type: "reauth" }
  | { type: "acr_rejected"; description: string };

/**
 * Evaluate step-up params against session state.
 * max_age is checked first (re-auth may refresh the session).
 * Returns null if all checks pass.
 */
async function evaluate(
  params: StepUpParams,
  session: SessionInfo
): Promise<StepUpAction | null> {
  const maxAgeStr = params.max_age;
  const maxAge =
    maxAgeStr !== undefined ? Number.parseInt(maxAgeStr, 10) : undefined;
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
    const assurance = await getAssuranceForOAuth(session.userId);
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
