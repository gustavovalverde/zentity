import "server-only";

import crypto from "node:crypto";

import {
  basicToClientCredentials,
  validateClientCredentials,
} from "@better-auth/oauth-provider";
import { APIError } from "better-auth";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

import { env } from "@/env";
import {
  resolveAgentSessionIdFromPairwiseSub,
  resolveAgentSubForClient,
} from "@/lib/agents/actor-subject";
import {
  buildAapClaims,
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
  buildOidcAssuranceClaims,
  computeAtHash,
} from "@/lib/assurance/oidc-claims";
import { getAccountAssurance } from "@/lib/assurance/posture";
import {
  AUTHENTICATION_CONTEXT_CLAIM,
  resolveAuthenticationContext,
} from "@/lib/auth/auth-context";
import {
  extractDpopThumbprint,
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "@/lib/auth/oidc/haip/opaque-access-token";
import { getClientSigningAlg, signJwt } from "@/lib/auth/oidc/jwt-signer";
import {
  resolveSubForClient,
  resolveUserIdFromSub,
} from "@/lib/auth/oidc/pairwise";
import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/oidc/well-known";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import {
  jwks as jwksTable,
  oauthClients,
} from "@/lib/db/schema/oauth-provider";

export const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";

const TOKEN_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token";
const TOKEN_TYPE_ID_TOKEN = "urn:ietf:params:oauth:token-type:id_token";

const SUPPORTED_SUBJECT_TYPES = new Set([
  TOKEN_TYPE_ACCESS_TOKEN,
  TOKEN_TYPE_ID_TOKEN,
]);

const SUPPORTED_OUTPUT_TYPES = new Set([
  TOKEN_TYPE_ACCESS_TOKEN,
  TOKEN_TYPE_ID_TOKEN,
]);

const authIssuer = getAuthIssuer();
const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
const jwksUrl = joinAuthIssuerPath(authIssuer, "oauth2/jwks");
const APP_LOGIN_HINT_CLAIM = "zentity_login_hint";

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "localhost"
  );
}

function isInstalledAgentBootstrapClient(input: {
  grantTypes: string[];
  redirectUris: string[];
}): boolean {
  return (
    input.grantTypes.includes(TOKEN_EXCHANGE_GRANT_TYPE) &&
    input.redirectUris.length > 0 &&
    input.redirectUris.every((redirectUri) => {
      try {
        const parsed = new URL(redirectUri);
        return (
          (parsed.protocol === "http:" || parsed.protocol === "https:") &&
          isLoopbackHostname(parsed.hostname)
        );
      } catch {
        return false;
      }
    })
  );
}

async function buildLocalJwks(kid: string) {
  const rows = await db.select().from(jwksTable).all();
  const keys = rows.map((row) => {
    const pub = JSON.parse(row.publicKey) as Record<string, unknown>;
    return { ...pub, kid: row.id, ...(row.alg ? { alg: row.alg } : {}) };
  });

  if (!keys.some((k) => k.kid === kid)) {
    const res = await fetch(jwksUrl, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      return createLocalJWKSet(
        (await res.json()) as { keys: Record<string, unknown>[] }
      );
    }
  }

  return createLocalJWKSet({ keys });
}

async function verifySubjectToken(
  token: string
): Promise<Record<string, unknown>> {
  const header = decodeProtectedHeader(token);
  if (!header.kid) {
    throw new Error("Missing kid in JWT header");
  }
  const jwks = await buildLocalJwks(header.kid);
  const { payload } = await jwtVerify(token, jwks, { issuer: authIssuer });
  return payload as Record<string, unknown>;
}

function getRequestingClientMetadata(clientId: string) {
  return db
    .select({
      grantTypes: oauthClients.grantTypes,
      redirectUris: oauthClients.redirectUris,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();
}

/**
 * RFC 8693 Token Exchange grant handler.
 *
 * Three exchange modes:
 * - Access Token → Access Token (scope attenuation, audience binding)
 * - Access Token → ID Token
 * - ID Token → Access Token
 *
 * Every exchanged token includes an `act` claim for the delegation chain.
 * Scope attenuation is enforced: requested scope must be a subset of the
 * subject token's scope. ID token subjects carry no scopes, so only
 * "openid" is allowed unless no scope is requested (defaults to "openid").
 */
function createTokenExchangeHandler(): (
  // biome-ignore lint/suspicious/noExplicitAny: oauth-provider dispatch signature is untyped
  ctx: any,
  // biome-ignore lint/suspicious/noExplicitAny: oauth-provider dispatch signature is untyped
  opts: any
) => Promise<Response> {
  return async (ctx, opts) => {
    const {
      subject_token: subjectToken,
      subject_token_type: subjectTokenType,
      requested_token_type: requestedTokenType,
      scope: requestedScope,
      resource,
      audience: audienceParam,
    } = ctx.body;

    if (!(subjectToken && subjectTokenType)) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_request",
        error_description: "subject_token and subject_token_type are required",
      });
    }

    if (!SUPPORTED_SUBJECT_TYPES.has(subjectTokenType)) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_request",
        error_description: `Unsupported subject_token_type: ${subjectTokenType}`,
      });
    }

    const outputType = requestedTokenType ?? TOKEN_TYPE_ACCESS_TOKEN;
    if (!SUPPORTED_OUTPUT_TYPES.has(outputType)) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_request",
        error_description: `Unsupported requested_token_type: ${outputType}`,
      });
    }

    // Authenticate the requesting client (Basic auth or body params)
    const authorization = ctx.request?.headers?.get("authorization") ?? null;
    const basicCreds = authorization
      ? basicToClientCredentials(authorization)
      : undefined;
    const clientId =
      (ctx.body.client_id as string | undefined) ?? basicCreds?.client_id;
    if (!clientId) {
      throw new APIError("BAD_REQUEST", {
        error: "invalid_client",
        error_description: "client_id is required",
      });
    }
    const clientSecret =
      (ctx.body.client_secret as string | undefined) ??
      basicCreds?.client_secret;
    const client = await validateClientCredentials(
      ctx,
      opts,
      clientId,
      clientSecret
    );

    // Verify the subject token JWT (must be issued by this AS)
    let subjectPayload: Record<string, unknown>;
    try {
      if (
        subjectTokenType === TOKEN_TYPE_ACCESS_TOKEN &&
        !subjectToken.startsWith("eyJ")
      ) {
        const opaqueSubject = await loadOpaqueAccessToken(subjectToken);
        if (!opaqueSubject?.userId || opaqueSubject.expiresAt < new Date()) {
          throw new Error("Opaque subject token not found");
        }

        if (opaqueSubject.dpopJkt) {
          const validDpop = await validateOpaqueAccessTokenDpop(
            ctx.request,
            opaqueSubject.dpopJkt
          );
          if (!validDpop) {
            throw new Error("Opaque subject token DPoP validation failed");
          }
        }

        const tokenSnapshot = opaqueSubject.referenceId
          ? await resolveTokenSnapshotForTokenJti(
              opaqueSubject.referenceId,
              opaqueSubject.clientId
            )
          : null;

        subjectPayload = {
          sub: opaqueSubject.userId,
          azp: opaqueSubject.clientId,
          client_id: opaqueSubject.clientId,
          scope: opaqueSubject.scopes.join(" "),
          exp: Math.floor(opaqueSubject.expiresAt.getTime() / 1000),
          ...(opaqueSubject.sessionId ? { sid: opaqueSubject.sessionId } : {}),
          ...(opaqueSubject.authContextId
            ? { [AUTHENTICATION_CONTEXT_CLAIM]: opaqueSubject.authContextId }
            : {}),
          ...(opaqueSubject.referenceId
            ? { jti: opaqueSubject.referenceId }
            : {}),
          ...(tokenSnapshot?.claims ?? {}),
        };
      } else {
        subjectPayload = await verifySubjectToken(subjectToken);
      }
    } catch {
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

    // Resolve pairwise sub → raw userId for id_token subjects
    const sourceClientId =
      (subjectPayload.azp as string | undefined) ??
      (subjectPayload.client_id as string | undefined) ??
      (typeof subjectPayload.aud === "string" ? subjectPayload.aud : undefined);
    let rawUserId = sub;
    if (sourceClientId) {
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

    // Scope attenuation — enforced for all subject token types
    const subjectScopes: string[] =
      typeof subjectPayload.scope === "string"
        ? subjectPayload.scope.split(" ")
        : [];
    const requestedScopes =
      typeof requestedScope === "string"
        ? requestedScope.split(" ").filter(Boolean)
        : [];
    const bootstrapOnlyRequest =
      subjectTokenType === TOKEN_TYPE_ACCESS_TOKEN &&
      requestedScopes.length > 0 &&
      requestedScopes.every((scope) => AGENT_BOOTSTRAP_SCOPE_SET.has(scope));
    const requestingClientMetadata = bootstrapOnlyRequest
      ? await getRequestingClientMetadata(client.clientId)
      : null;
    const canSelfBootstrap =
      bootstrapOnlyRequest &&
      sourceClientId === client.clientId &&
      requestingClientMetadata != null &&
      isInstalledAgentBootstrapClient({
        grantTypes: parseStoredStringArray(requestingClientMetadata.grantTypes),
        redirectUris: parseStoredStringArray(
          requestingClientMetadata.redirectUris
        ),
      });

    let targetScopes: string[];
    if (requestedScope) {
      if (subjectTokenType === TOKEN_TYPE_ACCESS_TOKEN) {
        // Access token subjects: requested must be a subset
        if (!canSelfBootstrap) {
          for (const s of requestedScopes) {
            if (!subjectScopes.includes(s)) {
              throw new APIError("BAD_REQUEST", {
                error: "invalid_scope",
                error_description: `Requested scope '${s}' exceeds subject token scope`,
              });
            }
          }
        }
      } else {
        // ID token subjects carry no scopes — only "openid" is safe
        for (const s of requestedScopes) {
          if (s !== "openid") {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_scope",
              error_description:
                "ID token subjects only support 'openid' scope",
            });
          }
        }
      }
      targetScopes = requestedScopes;
    } else if (subjectTokenType === TOKEN_TYPE_ID_TOKEN) {
      // ID token subjects carry no scopes — always default to openid
      targetScopes = ["openid"];
    } else {
      targetScopes = subjectScopes.length > 0 ? [...subjectScopes] : ["openid"];
    }

    // Build act claim with nesting (RFC 8693 §4.4)
    const actClaim: Record<string, unknown> = { sub: client.clientId };
    if (subjectPayload.act && typeof subjectPayload.act === "object") {
      actClaim.act = subjectPayload.act;
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
    const delegation = deriveDelegationClaim({
      parent: parentAccessTokenClaims,
      ...(typeof subjectPayload.jti === "string"
        ? { parentJti: subjectPayload.jti }
        : {}),
    });

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
    const dpopJkt = await extractDpopThumbprint(ctx.request);

    // Resolve target audience: resource (RFC 8707) > audience (RFC 8693) > issuer
    const targetAudience =
      (resource as string | undefined) ??
      (audienceParam as string | undefined) ??
      authIssuer;
    const includesBootstrapScope = targetScopes.some((scope) =>
      AGENT_BOOTSTRAP_SCOPE_SET.has(scope)
    );
    if (includesBootstrapScope) {
      if (targetScopes.some((scope) => !AGENT_BOOTSTRAP_SCOPE_SET.has(scope))) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_scope",
          error_description:
            "Bootstrap token exchanges may only request agent bootstrap scopes",
        });
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

    // Resolve pairwise subject for the requesting client (used by both output paths)
    const outputSub = client.redirectUris
      ? await resolveSubForClient(rawUserId, {
          subjectType: client.subjectType ?? null,
          redirectUris: parseStoredStringArray(client.redirectUris),
        })
      : rawUserId;

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

    // ID Token output
    if (outputType === TOKEN_TYPE_ID_TOKEN) {
      const assurance = await getAccountAssurance(rawUserId, {
        isAuthenticated: true,
      });
      const signingAlg = await getClientSigningAlg(client.clientId);
      const idTokenPayload: Record<string, unknown> = {
        iss: authIssuer,
        sub: outputSub,
        aud: client.clientId,
        azp: client.clientId,
        jti,
        iat: now,
        exp,
        act: actClaim,
        ...buildOidcAssuranceClaims(assurance, subjectAuth),
        ...(subjectSessionId ? { sid: subjectSessionId } : {}),
        ...(subjectSessionId
          ? {}
          : { [AUTHENTICATION_CONTEXT_CLAIM]: subjectAuth.id }),
        ...(subjectTokenType === TOKEN_TYPE_ACCESS_TOKEN
          ? { at_hash: computeAtHash(subjectToken, signingAlg) }
          : {}),
      };

      const idToken = await signJwt(idTokenPayload);
      return ctx.json(
        {
          access_token: idToken,
          issued_token_type: TOKEN_TYPE_ID_TOKEN,
          token_type: "N_A",
          expires_in: expiresIn,
        },
        {
          headers: {
            "Cache-Control": "no-store",
            Pragma: "no-cache",
          },
        }
      );
    }

    const accessTokenPayload: Record<string, unknown> = {
      iss: authIssuer,
      sub: outputSub,
      aud: targetAudience,
      azp: client.clientId,
      jti,
      scope: targetScopes.join(" "),
      iat: now,
      exp,
      ...(subjectSessionId ? { sid: subjectSessionId } : {}),
      ...(!subjectSessionId && subjectAuth
        ? { [AUTHENTICATION_CONTEXT_CLAIM]: subjectAuth.id }
        : {}),
      ...(includesBootstrapScope
        ? { zentity_token_use: AGENT_BOOTSTRAP_TOKEN_USE }
        : {}),
      ...(targetAudience === appUrl
        ? { [APP_LOGIN_HINT_CLAIM]: rawUserId }
        : {}),
      act: actClaim,
      ...(exchangedAccessTokenClaims ?? {}),
      ...(dpopJkt ? { cnf: { jkt: dpopJkt } } : {}),
    };

    const accessToken = await signJwt(accessTokenPayload);
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
  };
}

/**
 * Better-auth plugin that registers the token exchange grant handler.
 */
export function tokenExchangePlugin() {
  const handler = createTokenExchangeHandler();
  return {
    id: "token-exchange" as const,
    extensions: {
      "oauth-provider": {
        grantTypes: {
          [TOKEN_EXCHANGE_GRANT_TYPE]: handler,
        },
        grantTypeURIs: [TOKEN_EXCHANGE_GRANT_TYPE],
      },
    },
  };
}
