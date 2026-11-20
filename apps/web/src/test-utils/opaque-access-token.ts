import type { OAuthActorClaim } from "@better-auth/oauth-provider";

import { createHash, randomBytes } from "node:crypto";

import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";

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
      token: createHash("sha256").update(token).digest("base64url"),
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
