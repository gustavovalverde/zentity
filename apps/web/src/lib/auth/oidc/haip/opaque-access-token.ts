import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";

/**
 * Zentity's opaque access tokens live in the OAuth provider's token store, so
 * the provider validates, introspects, and revokes them like natively issued
 * ones. Zentity keeps two extension columns the provider never reads: the
 * claims a token exchange would otherwise put in a JWT, and the
 * authentication context of a token issued without a session.
 */

interface OpaqueAccessTokenExtensions {
  authContextId: string | null;
  exchangeClaims: Record<string, unknown>;
}

// The provider's default `storeTokens: "hashed"` storage key.
function hashOpaqueAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function parseExchangeClaims(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Reads the Zentity extension columns of an opaque access token. Validate the
 * token with the provider first; this read checks nothing.
 */
export async function loadOpaqueAccessTokenExtensions(
  token: string
): Promise<OpaqueAccessTokenExtensions | null> {
  const row = await db
    .select({
      authContextId: oauthAccessTokens.authContextId,
      exchangeClaims: oauthAccessTokens.exchangeClaims,
    })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, hashOpaqueAccessToken(token)))
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  return {
    authContextId: row.authContextId,
    exchangeClaims: parseExchangeClaims(row.exchangeClaims),
  };
}

/**
 * Mints an opaque access token in the OAuth provider's token store, so
 * userinfo, introspection, and Zentity's resource servers resolve it like a
 * natively issued one. Claims the token would otherwise carry in a JWT are
 * kept server-side.
 */
export async function mintOpaqueAccessToken(input: {
  authContextId?: string | undefined;
  clientId: string;
  dpopJkt?: string | undefined;
  exchangeClaims: Record<string, unknown>;
  expiresAt: Date;
  referenceId: string;
  scopes: string[];
  sessionId?: string | undefined;
  userId: string;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
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
      exchangeClaims: JSON.stringify(input.exchangeClaims),
    })
    .run();
  return token;
}
