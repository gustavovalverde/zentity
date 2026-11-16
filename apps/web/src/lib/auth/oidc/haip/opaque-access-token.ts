import "server-only";

import type { OAuthActorClaim } from "@better-auth/oauth-provider";

import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";

/**
 * Zentity's opaque access tokens live in the OAuth provider's token store, so
 * the provider validates, introspects, and revokes them like natively issued
 * ones, `act` and the per-token `accessTokenClaims` included. Zentity keeps
 * one extension column the provider never reads: the authentication context
 * of a token issued without a session. Introspection does not return it, so
 * no client learns the id of the authentication behind a token.
 */

// The provider's default `storeTokens: "hashed"` storage key.
function hashOpaqueAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * Reads the authentication context of an opaque access token. Validate the
 * token with the provider first; this read checks nothing.
 */
export async function loadOpaqueAccessTokenAuthContextId(
  token: string
): Promise<string | null> {
  const row = await db
    .select({ authContextId: oauthAccessTokens.authContextId })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, hashOpaqueAccessToken(token)))
    .limit(1)
    .get();
  return row?.authContextId ?? null;
}

/**
 * Mints an opaque access token in the OAuth provider's token store, so
 * userinfo, introspection, and Zentity's resource servers resolve it like a
 * natively issued one. The claims the token would otherwise carry in a JWT
 * are stored the way the provider stores a grant's per-issuance claims: `act`
 * in its actor column and the rest in its claims column. The provider's
 * `validateAccessToken` returns both in the token's payload.
 */
export async function mintOpaqueAccessToken(input: {
  accessTokenClaims?: Record<string, unknown> | undefined;
  act?: OAuthActorClaim | undefined;
  authContextId?: string | undefined;
  clientId: string;
  dpopJkt?: string | undefined;
  expiresAt: Date;
  referenceId: string;
  scopes: string[];
  sessionId?: string | undefined;
  userId: string;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const accessTokenClaims = input.accessTokenClaims ?? {};
  await db
    .insert(oauthAccessTokens)
    .values({
      token: hashOpaqueAccessToken(token),
      clientId: input.clientId,
      sessionId: input.sessionId ?? null,
      authContextId: input.authContextId ?? null,
      userId: input.userId,
      referenceId: input.referenceId,
      scopes: JSON.stringify(input.scopes),
      expiresAt: input.expiresAt,
      confirmation: input.dpopJkt
        ? JSON.stringify({ jkt: input.dpopJkt })
        : null,
      act: input.act ? JSON.stringify(input.act) : null,
      accessTokenClaims:
        Object.keys(accessTokenClaims).length > 0
          ? JSON.stringify(accessTokenClaims)
          : null,
    })
    .run();
  return token;
}
