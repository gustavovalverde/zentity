/**
 * Step-Up Authentication: Zentity assurance tiers requested via acr_values.
 *
 * - Pure helpers: parse and evaluate acr_values
 * - Authorize endpoint hook: enforceAuthorizeAcr (PAR + direct GET or POST)
 * - CIBA enforcement: token-exchange safety net (approval-time checks run in
 *   the CIBA approval decision, `oidc/ciba.ts`)
 *
 * For first-party clients (FPA), the CIBA token exchange safety net returns
 * HTTP 403 + auth_session so the client can re-authenticate via the
 * Authorization Challenge Endpoint instead of requiring a browser redirect.
 */
import type { AccountTier } from "@zentity/sdk/protocol";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { randomBytes } from "node:crypto";

import { getIssuer } from "@better-auth/oauth-provider";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { eq } from "drizzle-orm";

import { getAccountAssurance } from "@/lib/assurance/posture";
import {
  oauthProviderApi,
  oauthProviderOptions,
} from "@/lib/auth/oidc/oauth-provider";
import { authorizeRequestParameters } from "@/lib/auth/oidc/oauth-request";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import {
  authChallengeSessions,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const ACR_TIER_PATTERN = /^urn:zentity:assurance:tier-(\d)$/;
const WHITESPACE = /\s+/;
const IMPLICIT_RESPONSE_TYPE = /\b(token|id_token)\b/;
const PAR_URI_PREFIX = "urn:ietf:params:oauth:request_uri:";
const SESSION_LIFETIME_MS = 10 * 60 * 1000;
const PUSHED_ACR_PREFIX = "zentity:par-acr:";
// Outlives the request_uri and the signed query that carries it through
// sign-in, so every visit to the authorize endpoint finds the request.
const PUSHED_ACR_LIFETIME_MS = 10 * 60 * 1000;

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
 * Takes the space-separated `acr_values` parameter or the values already
 * split. Returns the first satisfiable ACR URI, or null if none are satisfied.
 */
export function findSatisfiedAcr(
  acrValues: string | readonly string[],
  userTier: AccountTier
): string | null {
  const requested =
    typeof acrValues === "string" ? parseAcrValues(acrValues) : acrValues;
  for (const acr of requested) {
    const requestedTier = extractTierFromAcr(acr);
    if (requestedTier !== null && userTier >= requestedTier) {
      return acr;
    }
  }
  return null;
}

type ErrorResponseMode = "query" | "fragment";

interface OAuthErrorRedirect {
  error: string;
  errorDescription: string;
  /** The authorization server issuer (RFC 9207). */
  iss?: string;
  mode?: ErrorResponseMode;
  state?: string;
}

/**
 * Builds an authorization error redirect the way the OAuth provider formats
 * its own: `error`, `error_description`, `state`, and `iss`, in the query or,
 * for fragment responses, in the fragment.
 */
export function buildOAuthErrorUrl(
  redirectUri: string,
  { error, errorDescription, iss, mode = "query", state }: OAuthErrorRedirect
): string {
  const params = new URLSearchParams({
    error,
    error_description: errorDescription,
  });
  if (state) {
    params.append("state", state);
  }
  if (iss) {
    params.append("iss", iss);
  }
  if (mode === "fragment") {
    return `${redirectUri}#${params.toString()}`;
  }
  const url = new URL(redirectUri);
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

/**
 * The response mode an authorization error goes back in, as the provider
 * chooses it: an explicit `response_mode`, otherwise the fragment for
 * response types that return tokens (OIDC Core §5, RFC 6749 §4.2.2.1).
 */
function errorResponseMode(params: {
  response_mode?: string;
  response_type?: string;
}): ErrorResponseMode {
  if (params.response_mode === "fragment" || params.response_mode === "query") {
    return params.response_mode;
  }
  return params.response_type &&
    IMPLICIT_RESPONSE_TYPE.test(params.response_type)
    ? "fragment"
    : "query";
}

// ---------------------------------------------------------------------------
// Authorize endpoint enforcement
// ---------------------------------------------------------------------------

interface AcrRequest {
  acr_values?: string;
  redirect_uri?: string;
  response_mode?: string;
  response_type?: string;
  state?: string;
}

function readAcrRequest(source: Record<string, unknown>): AcrRequest {
  const read = (key: keyof AcrRequest) =>
    typeof source[key] === "string" ? source[key] : undefined;
  return {
    acr_values: read("acr_values"),
    redirect_uri: read("redirect_uri"),
    response_mode: read("response_mode"),
    response_type: read("response_type"),
    state: read("state"),
  };
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
 * client registered (RFC 6749 §4.1.2.1). The provider refuses an authorization
 * request without `redirect_uri`, so this hook refuses it too rather than
 * redirecting to a registered default.
 */
async function rejectAcr(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
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
    buildOAuthErrorUrl(params.redirect_uri, {
      error: "interaction_required",
      errorDescription: description,
      iss: getIssuer(ctx, oauthProviderOptions(ctx.context)),
      mode: errorResponseMode(params),
      state: params.state,
    })
  );
}

interface PushedAcrRequest extends AcrRequest {
  clientId: string;
}

/**
 * Keeps the step-up parameters of a pushed request. The provider resolves a
 * `request_uri` inside `/oauth2/authorize`, after its before hooks run, so
 * `enforceAuthorizeAcr` reads them from here.
 */
export async function rememberPushedAcrRequest(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  requestUri: string
): Promise<void> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const clientId =
    typeof body.client_id === "string" ? body.client_id : undefined;
  const acrValues =
    typeof body.acr_values === "string" ? body.acr_values : undefined;
  if (!(clientId && acrValues && requestUri.startsWith(PAR_URI_PREFIX))) {
    return;
  }
  const value: PushedAcrRequest = { ...readAcrRequest(body), clientId };
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: `${PUSHED_ACR_PREFIX}${requestUri}`,
    value: JSON.stringify(value),
    expiresAt: new Date(Date.now() + PUSHED_ACR_LIFETIME_MS),
  });
}

async function enforceFromPar(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>,
  requestUri: string,
  clientId: string | undefined
) {
  if (!clientId) {
    return;
  }

  const record = await ctx.context.internalAdapter.findVerificationValue(
    `${PUSHED_ACR_PREFIX}${requestUri}`
  );
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
    return;
  }
  const params = JSON.parse(record.value) as PushedAcrRequest;
  if (params.clientId !== clientId || !params.acr_values) {
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

  await rejectAcr(ctx, db, clientId, params, rejection);
}

async function enforceFromRequest(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>,
  request: Record<string, unknown>,
  clientId: string | undefined
) {
  const params = readAcrRequest(request);
  if (!(params.acr_values && clientId)) {
    return;
  }

  const session = await getSessionFromCtx(ctx);
  if (!session) {
    return;
  }

  const rejection = await findAcrRejection(params.acr_values, session.user.id);
  if (rejection) {
    await rejectAcr(ctx, db, clientId, params, rejection);
  }
}

/**
 * Enforce Zentity assurance tiers requested through `acr_values` on the
 * authorize endpoint, whether the request arrives as a GET query or a POST
 * form. The provider treats `acr_values` as voluntary and owns `max_age`; an
 * unmet tier returns `interaction_required` to the client.
 */
// biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
export async function enforceAuthorizeAcr(ctx: any, db: LibSQLDatabase<any>) {
  const request = authorizeRequestParameters(ctx);
  const clientId =
    typeof request.client_id === "string" ? request.client_id : undefined;
  const requestUri =
    typeof request.request_uri === "string" ? request.request_uri : undefined;

  if (requestUri?.startsWith(PAR_URI_PREFIX)) {
    await enforceFromPar(ctx, db, requestUri, clientId);
  } else {
    await enforceFromRequest(ctx, db, request, clientId);
  }
}

// ---------------------------------------------------------------------------
// CIBA enforcement
// ---------------------------------------------------------------------------

/**
 * The CIBA request fields the token-time step-up check reads, as stored:
 * the plugin writes `acrValues` and `resources` as JSON arrays.
 */
export interface CibaStepUpRecord {
  acrValues: string | null;
  resources: string | null;
  scope: string;
  status: string;
  userId: string;
}

/**
 * Safety net: re-check acr_values at CIBA token exchange time, against the
 * request the /oauth2/token before-hook loaded. The user's tier can drop
 * between approval and the poll.
 *
 * For first-party clients: returns 403 + auth_session (FPA step-up path).
 * For other clients: returns 400 interaction_required (standard behavior).
 */
export async function enforceCibaTokenAcr(
  // biome-ignore lint/suspicious/noExplicitAny: middleware context is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle schema generic
  db: LibSQLDatabase<any>,
  record: CibaStepUpRecord
) {
  const acrValues = parseStoredStringArray(record.acrValues);
  if (acrValues.length === 0 || record.status !== "approved") {
    return;
  }

  const assurance = await getAccountAssurance(record.userId, {
    isAuthenticated: true,
  });
  const satisfied = findSatisfiedAcr(acrValues, assurance.tier);
  const requested = acrValues.join(" ");

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
        // The poll is refused here, so the token endpoint never verifies
        // this proof. The provider API verifies it, nonce included, before
        // its key binds the auth_session.
        const dpopJkt = (await oauthProviderApi(ctx).verifyDpopProof())?.jkt;

        await db.insert(authChallengeSessions).values({
          authSession,
          clientId,
          userId: record.userId,
          scope: record.scope,
          resource: parseStoredStringArray(record.resources)[0] ?? null,
          // The authorization challenge reads the space-separated form.
          acrValues: requested,
          dpopJkt: dpopJkt ?? null,
          state: "pending",
          expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
        });

        // The client re-authenticates at the authorization challenge with
        // the same key, so it gets the nonce verifyDpopProof set for its next
        // proof. A before-hook error reaches the client with its own headers
        // only.
        throw new APIError(
          "FORBIDDEN",
          {
            error: "insufficient_authorization",
            auth_session: authSession,
            error_description: `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${requested}`,
          },
          ctx.responseHeaders
        );
      }
    }

    throw new APIError("BAD_REQUEST", {
      error: "interaction_required",
      error_description: `User assurance is tier-${assurance.tier}, does not satisfy acr_values: ${requested}`,
    });
  }
}
