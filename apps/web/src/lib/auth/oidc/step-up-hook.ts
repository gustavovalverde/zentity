/**
 * Step-Up Authentication Hook — Authorize endpoint enforcement
 *
 * Reads PAR record from DB (non-destructive peek), resolves the session
 * from the request cookie, and enforces acr_values / max_age before the
 * authorize endpoint runs. Throws APIError("FOUND") for redirect responses.
 *
 * The standard PAR resolver still consumes (deletes) the record later.
 * On max_age re-auth, the record is preserved and its TTL extended so
 * the user can re-enter after login.
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import { getAssuranceForOAuth } from "@/lib/assurance/data";
import { getAuthIssuer } from "@/lib/auth/issuer";
import {
  buildOAuthErrorUrl,
  findSatisfiedAcr,
  isMaxAgeExceeded,
} from "@/lib/auth/oidc/step-up";
import { sessions } from "@/lib/db/schema/auth";
import { haipPushedRequests } from "@/lib/db/schema/haip";

const PAR_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";
const MAX_AGE_REAUTH_TTL_MS = 300_000; // 5 min for re-auth

interface ParParams {
  acr_values?: string;
  max_age?: string;
  prompt?: string;
  redirect_uri?: string;
  state?: string;
  [key: string]: string | undefined;
}

const SESSION_COOKIE_RE = /(?:__Secure-)?better-auth[.-]session_token=([^;]+)/;

function resolveSessionToken(headers: Headers): string | null {
  const cookie = headers.get("cookie") ?? "";
  const match = SESSION_COOKIE_RE.exec(cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

function throwRedirect(url: string): never {
  throw new APIError("FOUND", undefined, new Headers({ location: url }));
}

/**
 * Enforce acr_values and max_age on the authorize endpoint.
 * Called from the global before hook for /oauth2/authorize.
 *
 * Peeks at the PAR record without consuming it. On max_age failure,
 * extends the PAR TTL and redirects to login. On acr_values failure,
 * deletes the PAR record and redirects to the RP with an error.
 */
// biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
export async function enforceStepUp(ctx: any, db: LibSQLDatabase<any>) {
  const requestUri =
    typeof ctx.query?.request_uri === "string"
      ? ctx.query.request_uri
      : undefined;
  if (!requestUri?.startsWith(PAR_URI_PREFIX)) {
    return;
  }

  const clientId =
    typeof ctx.query?.client_id === "string" ? ctx.query.client_id : undefined;
  if (!clientId) {
    return;
  }

  // Peek at the PAR record (non-destructive — resolver consumes later)
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

  const params = JSON.parse(record.requestParams) as ParParams;
  const acrValues = params.acr_values;
  const maxAgeStr = params.max_age;

  if (!acrValues && maxAgeStr === undefined) {
    return;
  }

  // Resolve session from cookie
  const token = resolveSessionToken(ctx.headers);
  if (!token) {
    return; // No session → authorize endpoint will redirect to login
  }

  const session = await db
    .select({ userId: sessions.userId, createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.token, token))
    .limit(1)
    .get();

  if (!session) {
    return; // Invalid session → authorize endpoint handles it
  }

  const maxAge =
    maxAgeStr !== undefined ? Number.parseInt(maxAgeStr, 10) : undefined;
  const maxAgeExceeded =
    maxAge !== undefined &&
    !Number.isNaN(maxAge) &&
    isMaxAgeExceeded(session.createdAt, maxAge);
  const isPromptNone = params.prompt === "none";
  const redirectUri = params.redirect_uri;

  // prompt=none + max_age: can't redirect to login
  if (isPromptNone && maxAgeExceeded && redirectUri) {
    await db
      .delete(haipPushedRequests)
      .where(eq(haipPushedRequests.id, record.id))
      .run();
    throwRedirect(
      buildOAuthErrorUrl(
        redirectUri,
        params.state,
        "login_required",
        "Session exceeds max_age and prompt=none forbids interaction"
      )
    );
  }

  // max_age exceeded → redirect to login, preserve PAR for re-entry
  if (maxAgeExceeded) {
    // Extend PAR TTL so the user has time to re-authenticate
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

  // acr_values enforcement
  if (acrValues) {
    const assurance = await getAssuranceForOAuth(session.userId);
    const satisfied = findSatisfiedAcr(acrValues, assurance.tier);

    if (!satisfied) {
      // Consume PAR record — flow is over for the RP
      await db
        .delete(haipPushedRequests)
        .where(eq(haipPushedRequests.id, record.id))
        .run();

      if (!redirectUri) {
        throw new APIError("BAD_REQUEST", {
          message: "interaction_required: no redirect_uri to return error",
        });
      }

      throwRedirect(
        buildOAuthErrorUrl(
          redirectUri,
          params.state,
          "interaction_required",
          `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${acrValues}`
        )
      );
    }
  }
}
