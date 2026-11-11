import "server-only";

import type { GenericEndpointContext } from "@better-auth/core";
import type { BetterAuthPlugin } from "better-auth";
import type { JWTPayload } from "jose";

import {
  createDpopNonce,
  createDpopReplayStore,
  enforceDpopBinding,
  getDpopJktFromPayload,
  isDpopBindingError,
  parseAccessTokenAuthorization,
} from "@better-auth/core/oauth2";
import { HAIP_DPOP_SIGNING_ALGORITHMS } from "@better-auth/haip";
import {
  getOAuthProviderApi,
  type OAuthOptions,
  type Scope,
} from "@better-auth/oauth-provider";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { decodeProtectedHeader } from "jose";
import { z } from "zod";

import { isTokenRevoked } from "@/lib/auth/jwt";
import {
  dpopNonceOptions,
  nextDpopNonceHeaders,
} from "@/lib/auth/oidc/haip/dpop";

/**
 * Access-token validation for Zentity's own protected resources (tRPC, agent
 * registration, proof-of-human, validity, RP API).
 *
 * The OAuth provider validates the token (signature or stored record, expiry,
 * revocation, owning client, and the session it is bound to). Core DPoP
 * enforcement then checks the sender constraint: a DPoP-bound token needs the
 * DPoP scheme and a proof whose method, URL, age, `ath`, key, and
 * server-provided nonce match, with each proof `jti` reserved in the database
 * so it cannot be replayed on any instance. Nonces are keyed from the auth
 * secret, as on the token and UserInfo endpoints, so one nonce serves the whole
 * origin. Zentity adds what the provider does not check: JWT access tokens
 * carry `typ: at+jwt`, and Zentity's revoked-`jti` list.
 */

const ACCESS_TOKEN_JWT_TYPE = "at+jwt";

type AccessTokenFormat = "jwt" | "opaque";

export interface VerifiedAccessToken {
  /** JWT access tokens are audienced to another resource; opaque ones to Zentity. */
  format: AccessTokenFormat;
  payload: JWTPayload;
  token: string;
}

export interface VerifiedResourceRequest extends VerifiedAccessToken {
  /**
   * The next DPoP nonce (RFC 9449 §8.2) for the client, issued when the token
   * is DPoP-bound. The response to the request sends it as `DPoP-Nonce`.
   */
  dpopNonce?: string;
}

function isCompactJws(token: string): boolean {
  return token.split(".").length === 3;
}

function invalidToken(description: string): APIError {
  return new APIError("UNAUTHORIZED", {
    error: "invalid_token",
    error_description: description,
  });
}

function providerApi(ctx: GenericEndpointContext) {
  const plugin = ctx.context.getPlugin("oauth-provider") as {
    options: OAuthOptions<Scope[]>;
  } | null;
  if (!plugin) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message: "oauth-provider plugin is required",
    });
  }
  return getOAuthProviderApi(ctx, plugin.options);
}

/** The checks the provider does not make for Zentity-signed JWTs. */
export async function isZentityAccessToken(
  token: string,
  payload: JWTPayload
): Promise<boolean> {
  if (!isCompactJws(token)) {
    return true;
  }
  if (decodeProtectedHeader(token).typ !== ACCESS_TOKEN_JWT_TYPE) {
    return false;
  }
  return (
    typeof payload.jti === "string" && !(await isTokenRevoked(payload.jti))
  );
}

const ResourceRequestSchema = z.object({
  authorization: z.string().optional(),
  dpop: z.string().optional(),
  method: z.string().min(1),
  url: z.string().min(1),
});

/**
 * Server-only endpoints, so validation runs with the provider's own context.
 * App code calls them through `resource-principal.ts`, which turns a failure
 * into the client's `WWW-Authenticate` challenge.
 */
export function resourceAccessTokenPlugin() {
  return {
    id: "zentity-resource-access-token",
    endpoints: {
      verifyResourceRequest: createAuthEndpoint.serverOnly(
        { method: "POST", body: ResourceRequestSchema },
        async (ctx) => {
          const authorization = parseAccessTokenAuthorization(
            ctx.body.authorization
          );
          if (!authorization?.token || authorization.scheme === "Unknown") {
            throw invalidToken("access token required");
          }
          const payload = await providerApi(ctx).requireActiveAccessToken(
            authorization.token
          );
          if (!(await isZentityAccessToken(authorization.token, payload))) {
            throw invalidToken("invalid access token");
          }
          const { secret } = ctx.context;
          try {
            await enforceDpopBinding({
              payload,
              authorization,
              proofJwt: ctx.body.dpop,
              method: ctx.body.method,
              url: ctx.body.url,
              replayStore: createDpopReplayStore(ctx.context.internalAdapter),
              signingAlgorithms: HAIP_DPOP_SIGNING_ALGORITHMS,
              nonce: dpopNonceOptions(secret),
            });
          } catch (error) {
            if (isDpopBindingError(error)) {
              throw new APIError(
                "UNAUTHORIZED",
                { error: error.code, error_description: error.message },
                error.code === "use_dpop_nonce"
                  ? await nextDpopNonceHeaders(secret)
                  : undefined
              );
            }
            throw error;
          }
          return ctx.json({
            format: isCompactJws(authorization.token) ? "jwt" : "opaque",
            payload,
            token: authorization.token,
            ...(getDpopJktFromPayload(payload)
              ? { dpopNonce: await createDpopNonce({ secret }) }
              : {}),
          } satisfies VerifiedResourceRequest);
        }
      ),
      introspectZentityAccessToken: createAuthEndpoint.serverOnly(
        { method: "POST", body: z.object({ token: z.string().min(1) }) },
        async (ctx) => {
          const { token } = ctx.body;
          const payload = await providerApi(ctx).validateAccessToken(token);
          const active =
            payload.active === true &&
            (await isZentityAccessToken(token, payload));
          return ctx.json({
            format: isCompactJws(token) ? "jwt" : "opaque",
            payload: active ? payload : { active: false },
            token,
          } satisfies VerifiedAccessToken);
        }
      ),
    },
  } satisfies BetterAuthPlugin;
}
