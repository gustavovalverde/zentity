import "server-only";

import {
  basicToClientCredentials,
  validateClientCredentials,
} from "@better-auth/oauth-provider";
import { APIError } from "better-auth";
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";

import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/issuer";
import { signJwt } from "@/lib/auth/oidc/jwt-signer";
import { db } from "@/lib/db/connection";
import { jwks as jwksTable } from "@/lib/db/schema/jwks";

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
const jwksUrl = joinAuthIssuerPath(authIssuer, "pq-jwks");

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

/**
 * Extract the DPoP JWK thumbprint from the request's DPoP proof header.
 * Returns the thumbprint if a valid DPoP proof is present, undefined otherwise.
 */
async function extractDpopThumbprint(
  request: Request | undefined
): Promise<string | undefined> {
  const proof = request?.headers?.get("DPoP");
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
    // DPoP proof parsing failed — let the binding layer handle rejection
  }
  return undefined;
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
      subjectPayload = await verifySubjectToken(subjectToken);
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

    const user = await ctx.context.internalAdapter.findUserById(sub);
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

    let targetScopes: string[];
    if (requestedScope) {
      const requested = (requestedScope as string).split(" ");
      if (subjectTokenType === TOKEN_TYPE_ACCESS_TOKEN) {
        // Access token subjects: requested must be a subset
        for (const s of requested) {
          if (!subjectScopes.includes(s)) {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_scope",
              error_description: `Requested scope '${s}' exceeds subject token scope`,
            });
          }
        }
      } else {
        // ID token subjects carry no scopes — only "openid" is safe
        for (const s of requested) {
          if (s !== "openid") {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_scope",
              error_description:
                "ID token subjects only support 'openid' scope",
            });
          }
        }
      }
      targetScopes = requested;
    } else {
      targetScopes = subjectScopes.length > 0 ? [...subjectScopes] : ["openid"];
    }

    // Build act claim with nesting (RFC 8693 §4.4)
    const actClaim: Record<string, unknown> = { sub: client.clientId };
    if (subjectPayload.act && typeof subjectPayload.act === "object") {
      actClaim.act = subjectPayload.act;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600;
    const exp = now + expiresIn;

    // Resolve target audience: resource (RFC 8707) > audience (RFC 8693) > issuer
    const targetAudience =
      (resource as string | undefined) ??
      (audienceParam as string | undefined) ??
      authIssuer;

    // ID Token output
    if (outputType === TOKEN_TYPE_ID_TOKEN) {
      const idTokenPayload: Record<string, unknown> = {
        iss: authIssuer,
        sub,
        aud: client.clientId,
        azp: client.clientId,
        iat: now,
        exp,
        act: actClaim,
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

    // Access Token output — DPoP sender-constraining when proof is present
    const dpopJkt = await extractDpopThumbprint(ctx.request);

    const accessTokenPayload: Record<string, unknown> = {
      iss: authIssuer,
      sub,
      aud: targetAudience,
      azp: client.clientId,
      scope: targetScopes.join(" "),
      iat: now,
      exp,
      act: actClaim,
      ...(dpopJkt ? { cnf: { jkt: dpopJkt } } : {}),
    };

    const accessToken = await signJwt(accessTokenPayload);
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
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin init context is loosely typed
    init(ctx: any) {
      return {
        context: {
          customGrantTypeHandlers: {
            ...ctx.customGrantTypeHandlers,
            [TOKEN_EXCHANGE_GRANT_TYPE]: handler,
          },
        },
      };
    },
  };
}
