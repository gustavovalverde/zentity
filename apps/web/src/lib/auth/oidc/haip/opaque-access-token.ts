import "server-only";

import type { OAuthActorClaim } from "@better-auth/oauth-provider";

import { createHash, randomBytes } from "node:crypto";

import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";

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
      // The provider's default `storeTokens: "hashed"` storage key.
      token: createHash("sha256").update(token).digest("base64url"),
      clientId: input.clientId,
      sessionId: input.sessionId ?? null,
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
