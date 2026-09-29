import "server-only";

import type { GenericEndpointContext } from "@better-auth/core";

import {
  getOAuthProviderApi,
  type OAuthOptions,
  type Scope,
} from "@better-auth/oauth-provider";
import { APIError } from "better-auth";
import { decodeJwt } from "jose";

import { isTokenRevoked, verifyAuthIssuedJwt } from "@/lib/auth/jwt";
import { db } from "@/lib/db/connection";
import { revokedTokens } from "@/lib/db/schema/revoked-tokens";

/**
 * RFC 7009 revocation for JWT access tokens.
 *
 * The OAuth provider's native `/oauth2/revoke` endpoint authenticates the
 * client and revokes opaque access tokens and refresh tokens it issued. A JWT
 * access token has no server-side row, so this before-hook takes over for
 * JWT-shaped tokens: it authenticates the client through the provider, checks
 * the token's signature and ownership, and records its `jti` in
 * `revoked_token`. Userinfo, introspection, Zentity resource verification, and
 * the wallet runtime's delta poller (`/api/auth/oauth2/revoked`) all consult
 * that table.
 *
 * Per RFC 7009 §2.2 an unknown, invalid, expired, or foreign token still
 * answers 200 so the caller learns nothing about its validity.
 */

const ACCESS_TOKEN_TYP = "at+jwt";
const ACCESS_TOKEN_SCHEME_RE = /^(Bearer|DPoP)\s+/i;

function isJwtShaped(token: string): boolean {
  return token.split(".").length === 3;
}

function revocationAccepted(): Response {
  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authenticateRevokingClient(
  ctx: GenericEndpointContext
): Promise<string> {
  const options = ctx.context.getPlugin("oauth-provider")
    ?.options as OAuthOptions<Scope[]>;
  try {
    const { client } = await getOAuthProviderApi(
      ctx,
      options
    ).authenticateClient({ requireCredentials: false });
    return client.clientId;
  } catch (error) {
    if (error instanceof APIError && error.body?.error === "invalid_request") {
      throw new APIError("UNAUTHORIZED", {
        error: "invalid_client",
        error_description: "missing required credentials",
      });
    }
    throw error;
  }
}

function firstAudience(aud: unknown): string | null {
  if (typeof aud === "string") {
    return aud;
  }
  return Array.isArray(aud) && typeof aud[0] === "string" ? aud[0] : null;
}

export async function beforeRevokeJwtAccessToken(
  ctx: GenericEndpointContext
): Promise<Response | undefined> {
  const raw = ctx.body?.token;
  const token =
    typeof raw === "string" ? raw.replace(ACCESS_TOKEN_SCHEME_RE, "") : "";
  if (!isJwtShaped(token)) {
    return;
  }

  const clientId = await authenticateRevokingClient(ctx);
  const payload = await verifyAuthIssuedJwt(token, { typ: ACCESS_TOKEN_TYP });
  if (!payload || typeof payload.jti !== "string") {
    return revocationAccepted();
  }
  const issuedTo = payload.azp ?? payload.client_id;
  if (issuedTo !== clientId) {
    return revocationAccepted();
  }

  const act = payload.act as { sub?: unknown } | undefined;
  await db
    .insert(revokedTokens)
    .values({
      jti: payload.jti,
      reason:
        typeof ctx.body?.token_type_hint === "string"
          ? ctx.body.token_type_hint
          : null,
      actorSub: typeof act?.sub === "string" ? act.sub : null,
      audience: firstAudience(payload.aud),
    })
    .onConflictDoNothing({ target: revokedTokens.jti });

  return revocationAccepted();
}

/**
 * Returns the `jti` of a JWT-shaped access token when that token has been
 * revoked. The signature is not checked: a match only ever denies access.
 */
export async function revokedAccessTokenJti(
  token: string
): Promise<string | undefined> {
  const value = token.replace(ACCESS_TOKEN_SCHEME_RE, "");
  if (!isJwtShaped(value)) {
    return;
  }
  let jti: unknown;
  try {
    jti = decodeJwt(value).jti;
  } catch {
    return;
  }
  if (typeof jti === "string" && (await isTokenRevoked(jti))) {
    return jti;
  }
  return;
}

export async function beforeUserInfoRejectRevokedToken(
  ctx: GenericEndpointContext
): Promise<void> {
  const authorization = ctx.request?.headers.get("authorization");
  if (authorization && (await revokedAccessTokenJti(authorization))) {
    throw new APIError("UNAUTHORIZED", {
      error: "invalid_token",
      error_description: "access token revoked",
    });
  }
}

/**
 * Returns every `jti` revoked strictly after `sinceUnixMs`. Drives the wallet
 * runtime's delta poller. Bounded by `limit` to keep an attacker who is
 * spamming revocations from blowing up a poll cycle's response size; the
 * poller follows the next `since` cursor in the response on the next call.
 */
export async function listRevocationsSince(input: {
  sinceUnixMs: number;
  limit: number;
}): Promise<
  {
    revokedAt: Date;
    jti: string;
    reason: string | null;
  }[]
> {
  const since = new Date(input.sinceUnixMs);
  const rows = await db.query.revokedTokens.findMany({
    where: (table, { gt }) => gt(table.revokedAt, since),
    orderBy: (table, { asc }) => [asc(table.revokedAt), asc(table.jti)],
    limit: input.limit,
  });
  return rows.map((row) => ({
    revokedAt: row.revokedAt,
    jti: row.jti,
    reason: row.reason,
  }));
}
