import "server-only";

import crypto from "node:crypto";

import {
  basicToClientCredentials,
  validateClientCredentials,
} from "@better-auth/oauth-provider";
import { APIError } from "better-auth";
import { eq } from "drizzle-orm";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  SignJWT,
} from "jose";

import { env } from "@/env";
import { getAssuranceForOAuth } from "@/lib/assurance/data";
import {
  computeAcr,
  computeAcrEidas,
  computeAtHash,
  loginMethodToAmr,
} from "@/lib/assurance/oidc-claims";
import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/issuer";
import {
  AGENT_BOOTSTRAP_SCOPE_SET,
  AGENT_BOOTSTRAP_TOKEN_USE,
} from "@/lib/auth/oidc/agent-scopes";
import {
  getClientSigningAlg,
  getOrCreateSigningKey,
  signJwt,
} from "@/lib/auth/oidc/jwt-signer";
import {
  extractDpopThumbprint,
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "@/lib/auth/oidc/opaque-access-token";
import {
  resolveSubForClient,
  resolveUserIdFromSub,
} from "@/lib/auth/oidc/pairwise";
import {
  buildAapProfile,
  buildDelegationClaim,
  loadAapProfileForTokenJti,
  loadStoredAapSnapshotForTokenJti,
  persistAapSnapshotForToken,
  readAapProfileFromPayload,
} from "@/lib/ciba/aap-profile";
import {
  resolveAgentSessionIdFromPairwiseSub,
  resolveAgentSubForClient,
} from "@/lib/ciba/pairwise-agent";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { jwks as jwksTable } from "@/lib/db/schema/jwks";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

export const TOKEN_EXCHANGE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:token-exchange";

const TOKEN_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token";
const TOKEN_TYPE_ID_TOKEN = "urn:ietf:params:oauth:token-type:id_token";
const PURCHASE_AUTHORIZATION_TOKEN_TYPE =
  "urn:zentity:token-type:purchase-authorization";

const SUPPORTED_SUBJECT_TYPES = new Set([
  TOKEN_TYPE_ACCESS_TOKEN,
  TOKEN_TYPE_ID_TOKEN,
]);

const SUPPORTED_OUTPUT_TYPES = new Set([
  TOKEN_TYPE_ACCESS_TOKEN,
  TOKEN_TYPE_ID_TOKEN,
  PURCHASE_AUTHORIZATION_TOKEN_TYPE,
]);

const authIssuer = getAuthIssuer();
const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
const jwksUrl = joinAuthIssuerPath(authIssuer, "oauth2/jwks");

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

function getAudienceClient(clientId: string) {
  return db
    .select({
      clientId: oauthClients.clientId,
      redirectUris: oauthClients.redirectUris,
      subjectType: oauthClients.subjectType,
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

        const aapSnapshot = opaqueSubject.referenceId
          ? await loadAapProfileForTokenJti(
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
          ...(opaqueSubject.referenceId
            ? { jti: opaqueSubject.referenceId }
            : {}),
          ...(aapSnapshot?.aap ?? {}),
          ...(aapSnapshot?.aap.agent?.id
            ? { act: { sub: aapSnapshot.aap.agent.id } }
            : {}),
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

    let targetScopes: string[];
    if (requestedScope) {
      if (subjectTokenType === TOKEN_TYPE_ACCESS_TOKEN) {
        // Access token subjects: requested must be a subset
        if (!bootstrapOnlyRequest) {
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

    const actorSub = (subjectPayload.act as { sub?: string } | undefined)?.sub;
    const actorSessionId =
      actorSub && sourceClientId
        ? await resolveAgentSessionIdFromPairwiseSub(actorSub, sourceClientId)
        : null;

    const parentAapProfile = readAapProfileFromPayload(subjectPayload);
    const parentSnapshot =
      typeof subjectPayload.jti === "string"
        ? await loadStoredAapSnapshotForTokenJti(subjectPayload.jti)
        : null;
    const delegation = buildDelegationClaim({
      baseProfile: parentAapProfile,
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

    const outputActorId = actorSessionId
      ? await resolveAgentSubForClient(actorSessionId, client.clientId)
      : parentAapProfile.agent?.id;
    const exchangedAapProfile = buildAapProfile({
      actorId: outputActorId,
      approvalReference: parentAapProfile.oversight?.approval_reference,
      attestationTier: parentAapProfile.agent?.runtime?.attested
        ? "attested"
        : undefined,
      capabilities: parentAapProfile.capabilities,
      delegation,
      model: parentAapProfile.agent?.model?.id,
      requiresHumanApprovalFor:
        parentAapProfile.oversight?.requires_human_approval_for,
      runtime: parentAapProfile.agent?.runtime?.environment,
      sessionVersion: parentAapProfile.agent?.model?.version,
      taskId: parentAapProfile.task?.id,
      taskPurpose: parentAapProfile.task?.purpose,
      traceId: parentAapProfile.audit?.trace_id,
    });

    if (outputType === PURCHASE_AUTHORIZATION_TOKEN_TYPE) {
      if (subjectTokenType !== TOKEN_TYPE_ACCESS_TOKEN) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_request",
          error_description:
            "Purchase authorization artifacts require an access token subject",
        });
      }

      if (!dpopJkt) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_request",
          error_description:
            "Purchase authorization artifacts require a DPoP-bound token exchange request",
        });
      }

      const audienceClientId = audienceParam as string | undefined;
      if (!audienceClientId) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_request",
          error_description:
            "audience is required for purchase authorization artifacts",
        });
      }

      const audienceClient = await getAudienceClient(audienceClientId);
      if (!audienceClient) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_target",
          error_description: "Unknown purchase artifact audience",
        });
      }

      if (!(actorSub && sourceClientId && actorSessionId)) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_grant",
          error_description: "Subject token is missing actor context",
        });
      }

      const audienceSub = await resolveSubForClient(rawUserId, {
        subjectType: audienceClient.subjectType ?? null,
        redirectUris: parseStoredStringArray(audienceClient.redirectUris),
      });
      const audienceActSub = await resolveAgentSubForClient(
        actorSessionId,
        audienceClient.clientId
      );

      const rawAuthorizationDetails = subjectPayload.authorization_details;
      let authorizationDetails: unknown[];
      if (Array.isArray(rawAuthorizationDetails)) {
        authorizationDetails = rawAuthorizationDetails;
      } else if (rawAuthorizationDetails == null) {
        authorizationDetails = [];
      } else {
        authorizationDetails = [rawAuthorizationDetails];
      }
      const purchaseDetails = authorizationDetails.filter((detail) => {
        return (
          typeof detail === "object" &&
          detail !== null &&
          (detail as { type?: string }).type === "purchase"
        );
      });

      if (purchaseDetails.length === 0) {
        throw new APIError("BAD_REQUEST", {
          error: "invalid_grant",
          error_description:
            "Subject token does not contain an approved purchase authorization detail",
        });
      }

      const { kid, privateKey } = await getOrCreateSigningKey("EdDSA");
      const artifactPayload: Record<string, unknown> = {
        iss: authIssuer,
        sub: audienceSub,
        aud: audienceClient.clientId,
        jti,
        act: { sub: audienceActSub },
        authorization_details: purchaseDetails,
        iat: now,
        exp,
        ...(dpopJkt ? { cnf: { jkt: dpopJkt } } : {}),
      };

      const artifact = await new SignJWT(artifactPayload)
        .setProtectedHeader({
          alg: "EdDSA",
          kid,
          typ: "purchase-authorization+jwt",
        })
        .sign(privateKey);

      return ctx.json(
        {
          access_token: artifact,
          issued_token_type: PURCHASE_AUTHORIZATION_TOKEN_TYPE,
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

    // ID Token output
    if (outputType === TOKEN_TYPE_ID_TOKEN) {
      const assurance = await getAssuranceForOAuth(rawUserId);
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
        acr: computeAcr(assurance.tier),
        acr_eidas: computeAcrEidas(assurance.tier),
        amr: loginMethodToAmr(assurance.loginMethod),
        auth_time: assurance.authTime,
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
      ...(includesBootstrapScope
        ? { zentity_token_use: AGENT_BOOTSTRAP_TOKEN_USE }
        : {}),
      act: actClaim,
      ...exchangedAapProfile,
      ...(dpopJkt ? { cnf: { jkt: dpopJkt } } : {}),
    };

    const accessToken = await signJwt(accessTokenPayload);
    if (parentSnapshot) {
      await persistAapSnapshotForToken({
        tokenJti: jti,
        audienceClientId: client.clientId,
        snapshot: parentSnapshot,
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
