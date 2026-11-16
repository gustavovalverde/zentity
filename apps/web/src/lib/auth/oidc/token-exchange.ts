import "server-only";

import type { AuthContext, GenericEndpointContext } from "@better-auth/core";
import type { JWTPayload } from "jose";

import crypto from "node:crypto";

import { getConfirmationJkt } from "@better-auth/core/oauth2";
import {
  extendOAuthProvider,
  type OAuthExtensionGrantHandler,
  type OAuthExtensionGrantHandlerInput,
} from "@better-auth/oauth-provider";
import {
  parseScopes,
  tokenError,
  validateClientScopes,
} from "@better-auth/oauth-provider/internal";
import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import {
  AGENT_BOOTSTRAP_SCOPE_SET,
  AGENT_BOOTSTRAP_TOKEN_USE,
} from "@/lib/agents/session";
import { resolveAuthenticationContext } from "@/lib/auth/auth-context";
import {
  loadOpaqueAccessTokenAuthContextId,
  mintOpaqueAccessToken,
} from "@/lib/auth/oidc/haip/opaque-access-token";
import { isZentityAccessToken } from "@/lib/auth/oidc/resource-access-token";
import { db } from "@/lib/db/connection";
import { cibaApprovals } from "@/lib/db/schema/ciba";

export const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";

const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

/**
 * Zentity's RFC 8693 grant, cut down to the semantics of the provider's
 * `oauthTokenExchange` so a later port maps one to one:
 * - `publicClients: "dpop-bound"`: a public client exchanges only its own
 *   DPoP-bound token and proves its key.
 * - subject `maxDepth: 0`: no `actor_token`, and a subject with `act`, or one
 *   a CIBA approval issued, is refused.
 * - The only target is the app, and the output is an opaque access token, so
 *   no subject claim reaches another audience.
 *
 * It stays custom because the provider grant mints JWTs for any resource,
 * strips `openid`, has no hook for the bootstrap marker, and requires stored
 * consent for resources Zentity hosts itself.
 */
const TRAILING_SLASHES = /\/+$/;
const EXCHANGE_TARGET = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");
const EXCHANGED_TOKEN_TTL_SECONDS = 3600;
// A refresh token is never exchangeable: the output has no refresh token.
const NON_EXCHANGEABLE_SCOPES = new Set(["offline_access"]);

function deny(description: string): never {
  tokenError("BAD_REQUEST", "invalid_request", description);
}

function normalizeTarget(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
}

/**
 * Validates a subject token through the provider, which also authorizes the
 * caller: the token's client, or a resource server linked to its audience. An
 * unknown, malformed, or foreign token is `undefined`.
 */
async function validateSubject(
  provider: OAuthExtensionGrantHandlerInput["provider"],
  token: string,
  clientId: string
): Promise<JWTPayload | undefined> {
  try {
    const payload = await provider.validateAccessToken(token, clientId);
    return payload.active === true && isZentityAccessToken(token, payload)
      ? payload
      : undefined;
  } catch (error) {
    if (isAPIError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function hasCibaApproval(referenceId: unknown): Promise<boolean> {
  if (typeof referenceId !== "string" || !referenceId) {
    return false;
  }
  const row = await db
    .select({ id: cibaApprovals.id })
    .from(cibaApprovals)
    .where(eq(cibaApprovals.referenceId, referenceId))
    .limit(1)
    .get();
  return Boolean(row);
}

/**
 * The subject's authentication context, resolved on the server and never
 * read from a claim: its session's, or for an opaque token without a session,
 * the one stored with the token.
 */
async function resolveSubjectAuthContextId(
  subjectToken: string,
  subject: JWTPayload
): Promise<string | null> {
  const sessionId = typeof subject.sid === "string" ? subject.sid : null;
  const authContextId =
    sessionId || subjectToken.split(".").length === 3
      ? null
      : await loadOpaqueAccessTokenAuthContextId(subjectToken);
  const context = await resolveAuthenticationContext({
    authContextId,
    sessionId,
  });
  return context?.id ?? null;
}

function requestedTarget(body: Record<string, unknown>): void {
  const targets = [body.resource, body.audience]
    .flat()
    .filter((target) => target != null);
  if (targets.length === 0) {
    deny("resource or audience is required");
  }
  const [target] = targets;
  if (
    targets.length !== 1 ||
    typeof target !== "string" ||
    normalizeTarget(target) !== EXCHANGE_TARGET
  ) {
    tokenError(
      "BAD_REQUEST",
      "invalid_target",
      "each resource or audience must be a registered resource"
    );
  }
}

function hasDpopProof(ctx: GenericEndpointContext): boolean {
  return Boolean(ctx.headers?.get("dpop"));
}

async function exchangeToken({
  ctx,
  provider,
}: OAuthExtensionGrantHandlerInput) {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const subjectToken = body.subject_token;
  if (typeof subjectToken !== "string" || !subjectToken) {
    deny("subject_token is required");
  }
  if (body.subject_token_type !== ACCESS_TOKEN_TYPE) {
    deny(`subject_token_type must be ${ACCESS_TOKEN_TYPE}`);
  }
  if (
    body.requested_token_type !== undefined &&
    body.requested_token_type !== ACCESS_TOKEN_TYPE
  ) {
    deny("requested_token_type is not supported");
  }
  if (body.actor_token !== undefined || body.actor_token_type !== undefined) {
    deny("actor_token is not supported");
  }
  requestedTarget(body);

  // A confidential client must still send its secret.
  const { client, confirmation } = await provider.authenticateClient({
    requireCredentials: false,
  });
  if (!hasDpopProof(ctx)) {
    tokenError(
      "BAD_REQUEST",
      "invalid_dpop_proof",
      "DPoP proof header is required"
    );
  }

  const subject = await validateSubject(
    provider,
    subjectToken,
    client.clientId
  );
  if (
    !subject ||
    typeof subject.sub !== "string" ||
    !subject.sub ||
    typeof subject.exp !== "number"
  ) {
    deny("subject_token is invalid");
  }
  // RFC 9396 §9: the exchanged token would not carry the approved details.
  if (subject.authorization_details !== undefined) {
    deny("subject_token must not carry authorization_details");
  }
  // Every CIBA token names an actor, and its approval record holds even if a
  // token reaches here without one.
  if (
    subject.act !== undefined ||
    (await hasCibaApproval(subject.reference_id))
  ) {
    deny("subject_token must not be a delegated token");
  }

  const ownSubject = subject.client_id === client.clientId;
  const subjectJkt = getConfirmationJkt(subject.cnf);
  if (client.tokenEndpointAuthMethod === "none") {
    // A public client cannot prove it is the resource server in another
    // client's audience.
    if (!ownSubject) {
      deny("subject_token is invalid");
    }
    if (!subjectJkt) {
      deny("a public client may only exchange a DPoP-bound subject_token");
    }
  }
  // A self-exchange stays within the grant the subject already holds; a
  // resource server needs the user's consent, which only a client that skips
  // consent has without a prompt.
  if (!(ownSubject || client.skipConsent)) {
    deny("the user has not consented to this client for this exchange");
  }

  const exchangeable = parseScopes(subject.scope as string | undefined).filter(
    (scope) => !NON_EXCHANGEABLE_SCOPES.has(scope)
  );
  const requested =
    typeof body.scope === "string" && body.scope.trim()
      ? [...new Set(parseScopes(body.scope))]
      : undefined;
  // Without a requested scope the exchange keeps the subject's scopes the
  // client registered, except the agent bootstrap scopes, which it issues
  // only on request.
  const scopes =
    requested ??
    exchangeable.filter(
      (scope) =>
        !AGENT_BOOTSTRAP_SCOPE_SET.has(scope) &&
        (!client.scopes || client.scopes.includes(scope))
    );
  if (scopes.length === 0) {
    tokenError(
      "BAD_REQUEST",
      "invalid_scope",
      "Subject token has no scope this client can exchange"
    );
  }
  const widened = scopes.find((scope) => !exchangeable.includes(scope));
  if (widened) {
    tokenError(
      "BAD_REQUEST",
      "invalid_scope",
      `scope ${widened} is not available through token exchange`
    );
  }
  validateClientScopes(client, scopes);
  const bootstrap = scopes.some((scope) =>
    AGENT_BOOTSTRAP_SCOPE_SET.has(scope)
  );
  if (
    bootstrap &&
    scopes.some((scope) => !AGENT_BOOTSTRAP_SCOPE_SET.has(scope))
  ) {
    tokenError(
      "BAD_REQUEST",
      "invalid_scope",
      "Bootstrap token exchanges may only request agent bootstrap scopes"
    );
  }

  // A self-exchange stays bound to the subject's key; a resource server never
  // holds that key, so it binds its own.
  const dpopJkt = getConfirmationJkt(
    await provider.resolveConfirmation({
      client,
      scopes: [],
      ...(confirmation ? { confirmation } : {}),
      ...(ownSubject && subjectJkt ? { expectedJkt: subjectJkt } : {}),
    })
  );
  if (!dpopJkt) {
    tokenError(
      "BAD_REQUEST",
      "invalid_dpop_proof",
      "DPoP proof header is required"
    );
  }

  const authContextId = await resolveSubjectAuthContextId(
    subjectToken,
    subject
  );
  if (!authContextId) {
    deny("subject_token has no authentication context");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(now + EXCHANGED_TOKEN_TTL_SECONDS, subject.exp);
  if (exp <= now) {
    deny("the token this grant derives from has expired");
  }

  const sessionId = typeof subject.sid === "string" ? subject.sid : undefined;
  const accessToken = await mintOpaqueAccessToken({
    accessTokenClaims: bootstrap
      ? { zentity_token_use: AGENT_BOOTSTRAP_TOKEN_USE }
      : {},
    authContextId: sessionId ? undefined : authContextId,
    clientId: client.clientId,
    dpopJkt,
    expiresAt: new Date(exp * 1000),
    referenceId: crypto.randomUUID(),
    scopes,
    sessionId,
    userId: subject.sub,
  });
  return ctx.json(
    {
      access_token: accessToken,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: "DPoP",
      expires_in: exp - now,
      scope: scopes.join(" "),
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } }
  );
}

/**
 * Better-auth plugin that registers the RFC 8693 token-exchange grant through
 * `extendOAuthProvider`. The handler mints its opaque token into the
 * provider's store; it uses only the provider's client authentication,
 * token validation, and DPoP confirmation.
 */
export function tokenExchangePlugin() {
  // The token endpoint returns the handler result directly, so the grant
  // returns the framework `Response` just like the built-in grants do.
  const handler = exchangeToken as unknown as OAuthExtensionGrantHandler;
  return {
    id: "token-exchange" as const,
    init(ctx: AuthContext) {
      extendOAuthProvider(ctx, {
        grants: { [TOKEN_EXCHANGE_GRANT_TYPE]: handler },
      });
    },
  };
}
