import "server-only";

import type { AuthContext } from "@better-auth/core";
import type { JWTPayload } from "jose";

import crypto from "node:crypto";

import {
  getConfirmationJkt,
  getDpopJktFromPayload,
} from "@better-auth/core/oauth2";
import {
  extendOAuthProvider,
  type OAuthActorClaim,
  type OAuthExtensionGrantHandler,
  type OAuthExtensionGrantHandlerInput,
} from "@better-auth/oauth-provider";
import { APIError } from "better-auth";
import { eq } from "drizzle-orm";

import { env } from "@/env";
import {
  resolveAgentSessionIdFromPairwiseSub,
  resolveAgentSubForClient,
} from "@/lib/agents/actor-subject";
import {
  buildAapClaims,
  DelegationDepthExceededError,
  deriveDelegationClaim,
  getAapClaimsFromPayload,
} from "@/lib/agents/claims";
import {
  AGENT_BOOTSTRAP_SCOPE_SET,
  AGENT_BOOTSTRAP_TOKEN_USE,
} from "@/lib/agents/session";
import {
  findStoredTokenSnapshotByJti,
  persistTokenSnapshot,
  resolveTokenSnapshotForTokenJti,
} from "@/lib/agents/token-snapshot";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  resolveAuthenticationContext,
} from "@/lib/auth/auth-context";
import { PROTECTED_RESOURCE_METADATA_FIELD } from "@/lib/auth/oidc/client-metadata";
import { mintOpaqueAccessToken } from "@/lib/auth/oidc/haip/opaque-access-token";
import {
  getProtectedResourceAudiences,
  isZentityHostedResource,
} from "@/lib/auth/oidc/haip/resource-metadata";
import { signJwt } from "@/lib/auth/oidc/jwt-signer";
import { resolveUserIdFromSub } from "@/lib/auth/oidc/pairwise";
import { isZentityAccessToken } from "@/lib/auth/oidc/resource-access-token";
import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { logger } from "@/lib/logging/logger";

export const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";

const TOKEN_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token";

const authIssuer = getAuthIssuer();
const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
const oidc4vciCredentialAudience = `${authIssuer}/oidc4vci/credential`;
const rpApiAudience = `${authIssuer}/resource/rp-api`;
const tokenExchangeAudiences = getProtectedResourceAudiences({
  appUrl,
  authIssuer,
  mcpPublicUrl: env.MCP_PUBLIC_URL,
  oidc4vciCredentialAudience,
  rpApiAudience,
});
const tokenExchangeUserinfoAudience = joinAuthIssuerPath(
  authIssuer,
  "oauth2/userinfo"
);
const TRAILING_SLASHES = /\/+$/;
// Requests a refresh token, and token exchange never issues one.
const OFFLINE_ACCESS_SCOPE = "offline_access";

function parseScopeList(value: unknown): string[] {
  return typeof value === "string"
    ? [...new Set(value.split(" ").filter(Boolean))]
    : [];
}

function invalidScope(description: string): APIError {
  return new APIError("BAD_REQUEST", {
    error: "invalid_scope",
    error_description: description,
  });
}

/**
 * The scopes the exchanged token carries, always a subset of the subject
 * token's. Without a requested scope it keeps the subject's scopes the client
 * registered, except `offline_access`, which it never issues, and the agent
 * bootstrap scopes, which it issues only on request.
 */
function resolveExchangedScopes(input: {
  clientScopes: readonly string[] | undefined;
  requestedScopes: string[];
  subjectScopes: string[];
}): string[] {
  const { clientScopes, requestedScopes, subjectScopes } = input;
  if (requestedScopes.length > 0) {
    for (const scope of requestedScopes) {
      if (scope === OFFLINE_ACCESS_SCOPE) {
        throw invalidScope(
          `Requested scope '${scope}' is not available through token exchange`
        );
      }
      if (!subjectScopes.includes(scope)) {
        throw invalidScope(
          `Requested scope '${scope}' exceeds subject token scope`
        );
      }
    }
    return requestedScopes;
  }

  const inherited = subjectScopes.filter(
    (scope) =>
      scope !== OFFLINE_ACCESS_SCOPE &&
      !AGENT_BOOTSTRAP_SCOPE_SET.has(scope) &&
      (!clientScopes || clientScopes.includes(scope))
  );
  if (inherited.length === 0) {
    throw invalidScope("Subject token has no scope this client can exchange");
  }
  return inherited;
}

function normalizeResourceAudience(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
}

function audienceIncludes(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") {
    return normalizeResourceAudience(audience) === expected;
  }

  return (
    Array.isArray(audience) &&
    audience.some(
      (value) =>
        typeof value === "string" &&
        normalizeResourceAudience(value) === expected
    )
  );
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function resolveClientResourceAudience(metadata: unknown): string | undefined {
  const metadataResource =
    parseJsonRecord(metadata)[PROTECTED_RESOURCE_METADATA_FIELD];
  return typeof metadataResource === "string" && metadataResource.length > 0
    ? normalizeResourceAudience(metadataResource)
    : undefined;
}

async function loadClientResourceAudience(
  clientId: string
): Promise<string | undefined> {
  const row = await db
    .select({ metadata: oauthClients.metadata })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();

  return resolveClientResourceAudience(row?.metadata);
}

/**
 * Whether the requesting client is the protected resource another client's
 * access token was issued for, by the resource it registered.
 */
async function isSubjectResourceServer(input: {
  clientId: string;
  sourceClientId: string | undefined;
  subjectAudience: unknown;
}): Promise<boolean> {
  if (!input.sourceClientId) {
    return false;
  }

  const clientResourceAudience = await loadClientResourceAudience(
    input.clientId
  );
  return (
    clientResourceAudience !== undefined &&
    tokenExchangeAudiences.includes(clientResourceAudience) &&
    audienceIncludes(input.subjectAudience, clientResourceAudience)
  );
}

/**
 * Validates an access-token subject with the provider (signature or stored
 * record, expiry, revocation, client, and bound session), plus Zentity's
 * `typ` and `jti` checks for JWTs.
 */
async function verifyAccessTokenSubject(
  provider: OAuthExtensionGrantHandlerInput["provider"],
  token: string
): Promise<JWTPayload> {
  // The subject token's DPoP binding is checked by the exchange, not here.
  const payload = await provider.validateAccessToken(token);
  if (payload.active !== true) {
    throw new Error("Subject token is not active");
  }
  if (!isZentityAccessToken(token, payload)) {
    throw new Error("Subject token is not a Zentity access token");
  }
  return payload;
}

function resolveTargetAudience(resource: unknown, audience: unknown): string {
  if (resource !== undefined && typeof resource !== "string") {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_target",
      error_description: "Token exchange supports a single resource audience",
    });
  }

  if (audience !== undefined && typeof audience !== "string") {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_target",
      error_description: "Token exchange supports a single audience value",
    });
  }

  return resource ?? audience ?? authIssuer;
}

function isValidTokenExchangeAudience(
  audience: string,
  scopes: string[]
): boolean {
  if (tokenExchangeAudiences.includes(audience)) {
    return true;
  }

  return (
    scopes.includes("openid") && audience === tokenExchangeUserinfoAudience
  );
}

/**
 * RFC 8693 Token Exchange grant handler: exchanges an access token this AS
 * issued for another access token, with scope attenuation and audience
 * binding. Every exchanged token includes an `act` claim for the delegation
 * chain, and its scope is a subset of both the subject token's scope and the
 * scopes the requesting client registered.
 */
function createTokenExchangeHandler(): OAuthExtensionGrantHandler {
  return (async ({ ctx, provider }: OAuthExtensionGrantHandlerInput) => {
    const {
      subject_token: subjectToken,
      subject_token_type: subjectTokenType,
      requested_token_type: requestedTokenType,
      scope: requestedScope,
      resource,
      audience: audienceParam,
    } = ctx.body as Record<string, unknown> & {
      subject_token?: string;
      subject_token_type?: string;
      requested_token_type?: string;
      scope?: string;
      resource?: unknown;
      audience?: unknown;
    };

    if (!(subjectToken && subjectTokenType)) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_request",
        error_description: "subject_token and subject_token_type are required",
      });
    }

    if (subjectTokenType !== TOKEN_TYPE_ACCESS_TOKEN) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_request",
        error_description: `Unsupported subject_token_type: ${subjectTokenType}`,
      });
    }

    if (
      requestedTokenType !== undefined &&
      requestedTokenType !== TOKEN_TYPE_ACCESS_TOKEN
    ) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_request",
        error_description: `Unsupported requested_token_type: ${requestedTokenType}`,
      });
    }

    // Authenticate the requesting client, which must have registered every
    // scope it requests. Token-exchange clients may be public (installed
    // agents bootstrapping), so credentials are not required.
    const requestedScopes = parseScopeList(requestedScope);
    const authenticated = await provider.authenticateClient({
      requireCredentials: false,
      scopes: requestedScopes,
    });
    const client = authenticated.client;

    // Validate the subject token, which this AS must have issued
    let subjectPayload: Record<string, unknown>;
    let subjectDpopJkt: string | undefined;
    let opaqueSubjectUserId: string | undefined;
    try {
      const verified = await verifyAccessTokenSubject(provider, subjectToken);
      subjectDpopJkt = getDpopJktFromPayload(verified);
      if (subjectToken.split(".").length === 3) {
        subjectPayload = verified as Record<string, unknown>;
      } else {
        const subjectUserId =
          typeof verified.sub === "string" ? verified.sub : undefined;
        const subjectClientId =
          typeof verified.client_id === "string"
            ? verified.client_id
            : undefined;
        if (!(subjectUserId && subjectClientId)) {
          throw new Error("Opaque subject token has no user");
        }
        opaqueSubjectUserId = subjectUserId;
        const referenceId =
          typeof verified.reference_id === "string"
            ? verified.reference_id
            : undefined;
        const tokenSnapshot = referenceId
          ? await resolveTokenSnapshotForTokenJti(referenceId, subjectClientId)
          : null;

        // The provider returns the token's stored claims in its payload. The
        // audience is left out: only a JWT subject may be exchanged by the
        // resource server it names.
        const { aud: _audience, ...storedPayload } = verified;
        subjectPayload = {
          ...storedPayload,
          ...(referenceId ? { jti: referenceId } : {}),
          ...(tokenSnapshot?.claims ?? {}),
        };
      }
    } catch (cause) {
      logger.warn(
        {
          subjectTokenShape: subjectToken.startsWith("eyJ") ? "jwt" : "opaque",
          cause: cause instanceof Error ? cause.message : String(cause),
        },
        "token-exchange: subject token rejected"
      );
      throw new APIError("BAD_REQUEST", {
        error: "invalid_grant",
        error_description: "Subject token verification failed",
      });
    }

    const subjectSessionId =
      typeof subjectPayload.sid === "string" ? subjectPayload.sid : undefined;
    const subjectAuthContextId =
      typeof subjectPayload[AUTHENTICATION_CONTEXT_CLAIM] === "string"
        ? (subjectPayload[AUTHENTICATION_CONTEXT_CLAIM] as string)
        : undefined;
    const subjectAuth = await resolveAuthenticationContext({
      authContextId: subjectAuthContextId,
      sessionId: subjectSessionId,
    });

    const sub = subjectPayload.sub as string | undefined;
    if (!sub) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_grant",
        error_description: "Subject token has no sub claim",
      });
    }

    const sourceClientId =
      (subjectPayload.azp as string | undefined) ??
      (subjectPayload.client_id as string | undefined);

    // Only the client a subject token was issued to, or the protected
    // resource it was issued for, may exchange it.
    const exchangesAsResourceServer =
      sourceClientId !== client.clientId &&
      (await isSubjectResourceServer({
        clientId: client.clientId,
        sourceClientId,
        subjectAudience: subjectPayload.aud,
      }));
    if (sourceClientId !== client.clientId && !exchangesAsResourceServer) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_grant",
        error_description:
          "Subject token was not issued to the requesting client or for its resource",
      });
    }

    // A DPoP-bound subject token stays bound to its key, so the provider
    // requires a proof signed with it. The resource server the token was
    // issued for never holds that key, so it must prove its own instead.
    const bindsResourceServerKey =
      subjectDpopJkt !== undefined && exchangesAsResourceServer;
    const dpopJkt = getConfirmationJkt(
      await provider.resolveConfirmation({
        client,
        scopes: [],
        ...(authenticated.confirmation
          ? { confirmation: authenticated.confirmation }
          : {}),
        ...(subjectDpopJkt && !bindsResourceServerKey
          ? { expectedJkt: subjectDpopJkt }
          : {}),
      })
    );
    if (subjectDpopJkt && !dpopJkt) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_dpop_proof",
        error_description: "DPoP proof header is required",
      });
    }

    // A JWT subject carries the client-facing sub; resolve it to the user id.
    let rawUserId = opaqueSubjectUserId ?? sub;
    if (!opaqueSubjectUserId && sourceClientId) {
      rawUserId = (await resolveUserIdFromSub(sub, sourceClientId)) ?? sub;
    }

    const user = await ctx.context.internalAdapter.findUserById(rawUserId);
    if (!user) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_grant",
        error_description: "Subject user not found",
      });
    }

    if (!subjectAuth) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_grant",
        error_description: "Subject token is missing an authentication context",
      });
    }

    const targetScopes = resolveExchangedScopes({
      clientScopes: client.scopes,
      requestedScopes,
      subjectScopes: parseScopeList(subjectPayload.scope),
    });

    // Build act claim with nesting (RFC 8693 §4.4)
    const actClaim: OAuthActorClaim = {
      sub: client.clientId,
      sub_profile: "service",
    };
    if (subjectPayload.act && typeof subjectPayload.act === "object") {
      actClaim.act = subjectPayload.act as OAuthActorClaim;
    }

    const parentAccessTokenClaims = getAapClaimsFromPayload(subjectPayload);
    const parentActorSub = parentAccessTokenClaims.act?.sub;
    const actorSessionId =
      parentActorSub && sourceClientId
        ? await resolveAgentSessionIdFromPairwiseSub(
            parentActorSub,
            sourceClientId
          )
        : null;

    const storedSubjectSnapshot =
      typeof subjectPayload.jti === "string"
        ? await findStoredTokenSnapshotByJti(subjectPayload.jti)
        : null;
    const delegation = (() => {
      try {
        return deriveDelegationClaim({
          parent: parentAccessTokenClaims,
          ...(typeof subjectPayload.jti === "string"
            ? { parentJti: subjectPayload.jti }
            : {}),
        });
      } catch (error) {
        if (error instanceof DelegationDepthExceededError) {
          throw new APIError("BAD_REQUEST", {
            error: "invalid_grant",
            error_description:
              "Subject token exceeded the maximum delegation depth",
          });
        }
        throw error;
      }
    })();

    const now = Math.floor(Date.now() / 1000);
    const subjectExp =
      typeof subjectPayload.exp === "number" ? subjectPayload.exp : null;
    const defaultExpiresIn = 3600;
    const exp =
      subjectExp === null
        ? now + defaultExpiresIn
        : Math.min(now + defaultExpiresIn, subjectExp);
    const expiresIn = Math.max(exp - now, 0);

    if (expiresIn === 0) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_grant",
        error_description:
          "Exchanged token lifetime cannot exceed the subject token lifetime",
      });
    }
    const jti = crypto.randomUUID();

    // Resolve target audience: resource (RFC 8707) > audience (RFC 8693) > issuer
    const targetAudience = resolveTargetAudience(resource, audienceParam);
    if (!isValidTokenExchangeAudience(targetAudience, targetScopes)) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_target",
        error_description:
          "Token exchange target audience is not a registered protected resource",
      });
    }

    const includesBootstrapScope = targetScopes.some((scope) =>
      AGENT_BOOTSTRAP_SCOPE_SET.has(scope)
    );
    if (includesBootstrapScope) {
      if (targetScopes.some((scope) => !AGENT_BOOTSTRAP_SCOPE_SET.has(scope))) {
        throw invalidScope(
          "Bootstrap token exchanges may only request agent bootstrap scopes"
        );
      }

      // The user granted these scopes to the client the subject token was
      // issued to, not to a resource server that received it.
      if (exchangesAsResourceServer) {
        throw invalidScope(
          "Only the client a subject token was issued to may exchange it for agent bootstrap scopes"
        );
      }

      if (targetAudience !== appUrl) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_target",
          error_description:
            "Bootstrap token exchanges must target the app audience",
        });
      }

      if (!dpopJkt) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_request",
          error_description:
            "Bootstrap token exchanges require a DPoP-bound token exchange request",
        });
      }
    }

    const outputActorSub = actorSessionId
      ? await resolveAgentSubForClient(actorSessionId, client.clientId)
      : parentAccessTokenClaims.act?.sub;
    const exchangedAccessTokenClaims = outputActorSub
      ? buildAapClaims({
          act: {
            sub: outputActorSub,
            sessionId:
              actorSessionId ??
              parentAccessTokenClaims.act?.session_id ??
              outputActorSub,
            hostAttestation:
              parentAccessTokenClaims.act?.host_attestation ?? "unverified",
            ...(parentAccessTokenClaims.act?.did
              ? { did: parentAccessTokenClaims.act.did }
              : {}),
            ...(parentAccessTokenClaims.act?.host_id
              ? { hostId: parentAccessTokenClaims.act.host_id }
              : {}),
            ...(parentAccessTokenClaims.act?.operator
              ? { operator: parentAccessTokenClaims.act.operator }
              : {}),
            ...(parentAccessTokenClaims.act?.type
              ? { type: parentAccessTokenClaims.act.type }
              : {}),
          },
          task: {
            hash: parentAccessTokenClaims.task?.hash ?? jti,
            description:
              parentAccessTokenClaims.task?.description ?? "token-exchange",
            createdAt: parentAccessTokenClaims.task?.created_at ?? now,
            expiresAt: parentAccessTokenClaims.task?.expires_at ?? exp,
            ...(parentAccessTokenClaims.task?.constraints === undefined
              ? {}
              : { constraints: parentAccessTokenClaims.task.constraints }),
          },
          oversight: {
            approvalId: parentAccessTokenClaims.oversight?.approval_id ?? jti,
            approvedAt: parentAccessTokenClaims.oversight?.approved_at ?? now,
            method: parentAccessTokenClaims.oversight?.method ?? "session",
          },
          audit: {
            releaseId: parentAccessTokenClaims.audit?.release_id ?? "dev",
            contextId: parentAccessTokenClaims.audit?.context_id ?? jti,
            ...(parentAccessTokenClaims.audit?.request_id
              ? { requestId: parentAccessTokenClaims.audit.request_id }
              : {}),
            ...(parentAccessTokenClaims.audit?.ciba_request_id
              ? { cibaRequestId: parentAccessTokenClaims.audit.ciba_request_id }
              : {}),
          },
          capabilities: parentAccessTokenClaims.capabilities ?? null,
          delegation,
        })
      : undefined;

    // An agent-backed token names the agent session as its actor.
    const { act: agentActor, ...agentClaims } =
      exchangedAccessTokenClaims ?? {};
    const act: OAuthActorClaim = agentActor ? { ...agentActor } : actClaim;
    // A session-bound token resolves its authentication through the session.
    const accessTokenClaims: Record<string, unknown> = {
      ...(includesBootstrapScope
        ? { zentity_token_use: AGENT_BOOTSTRAP_TOKEN_USE }
        : {}),
      ...(subjectSessionId
        ? {}
        : { [AUTHENTICATION_CONTEXT_CLAIM]: subjectAuth.id }),
      ...agentClaims,
    };
    const accessToken = isZentityHostedResource(targetAudience)
      ? await mintOpaqueAccessToken({
          accessTokenClaims,
          act,
          clientId: client.clientId,
          dpopJkt,
          expiresAt: new Date(exp * 1000),
          referenceId: jti,
          scopes: targetScopes,
          sessionId: subjectSessionId,
          userId: rawUserId,
        })
      : await signJwt(
          {
            iss: authIssuer,
            sub: rawUserId,
            aud: targetAudience,
            azp: client.clientId,
            jti,
            scope: targetScopes.join(" "),
            iat: now,
            exp,
            ...(subjectSessionId ? { sid: subjectSessionId } : {}),
            ...accessTokenClaims,
            act,
            ...(dpopJkt ? { cnf: { jkt: dpopJkt } } : {}),
          },
          { typ: "at+jwt" }
        );
    if (storedSubjectSnapshot) {
      await persistTokenSnapshot({
        tokenJti: jti,
        audienceClientId: client.clientId,
        snapshot: storedSubjectSnapshot,
      });
    }
    return ctx.json(
      {
        access_token: accessToken,
        issued_token_type: TOKEN_TYPE_ACCESS_TOKEN,
        token_type: dpopJkt ? "DPoP" : "Bearer",
        expires_in: expiresIn,
        scope: targetScopes.join(" "),
      },
      {
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      }
    );
    // The token endpoint returns the handler result directly, so a self-signed
    // grant returns the framework `Response` just like the built-in grants do.
  }) as unknown as OAuthExtensionGrantHandler;
}

/**
 * Better-auth plugin that registers the RFC 8693 token-exchange grant through
 * `extendOAuthProvider`. The handler self-signs its tokens, so it does not call
 * `provider.issueTokens`; it only uses `provider.authenticateClient`.
 */
export function tokenExchangePlugin() {
  const handler = createTokenExchangeHandler();
  return {
    id: "token-exchange" as const,
    init(ctx: AuthContext) {
      extendOAuthProvider(ctx, {
        grants: { [TOKEN_EXCHANGE_GRANT_TYPE]: handler },
      });
    },
  };
}
