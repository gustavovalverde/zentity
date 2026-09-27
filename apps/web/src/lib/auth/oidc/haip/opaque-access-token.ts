import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createDpopAccessTokenValidator } from "@better-auth/haip";
import { eq } from "drizzle-orm";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";

import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";

const dpopValidator = createDpopAccessTokenValidator({ requireDpop: false });

interface OpaqueAccessTokenRecord {
  authContextId: string | null;
  clientId: string;
  dpopJkt: string | null;
  exchangeClaims: Record<string, unknown>;
  expiresAt: Date;
  referenceId: string | null;
  scopes: string[];
  sessionId: string | null;
  userId: string | null;
}

function hashOpaqueAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export async function extractDpopThumbprint(
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
    // Leave validation failures to the DPoP validator.
  }
  return undefined;
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

function jktFromConfirmation(confirmation: string | null): string | null {
  if (!confirmation) {
    return null;
  }
  try {
    const parsed = JSON.parse(confirmation) as { jkt?: unknown };
    return typeof parsed.jkt === "string" ? parsed.jkt : null;
  } catch {
    return null;
  }
}

export async function loadOpaqueAccessToken(
  token: string
): Promise<OpaqueAccessTokenRecord | null> {
  const row = await db
    .select({
      authContextId: oauthAccessTokens.authContextId,
      clientId: oauthAccessTokens.clientId,
      confirmation: oauthAccessTokens.confirmation,
      exchangeClaims: oauthAccessTokens.exchangeClaims,
      expiresAt: oauthAccessTokens.expiresAt,
      referenceId: oauthAccessTokens.referenceId,
      revoked: oauthAccessTokens.revoked,
      sessionId: oauthAccessTokens.sessionId,
      scopes: oauthAccessTokens.scopes,
      userId: oauthAccessTokens.userId,
    })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, hashOpaqueAccessToken(token)))
    .limit(1)
    .get();

  if (!row || row.revoked) {
    return null;
  }

  return {
    authContextId: row.authContextId,
    clientId: row.clientId,
    dpopJkt: jktFromConfirmation(row.confirmation),
    exchangeClaims: parseExchangeClaims(row.exchangeClaims),
    expiresAt: row.expiresAt,
    referenceId: row.referenceId,
    sessionId: row.sessionId,
    scopes: parseStoredStringArray(row.scopes),
    userId: row.userId,
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

export async function persistOpaqueAccessTokenDpopBinding(
  token: string,
  request: Request | undefined
): Promise<void> {
  if (token.startsWith("eyJ")) {
    return;
  }

  const dpopJkt = await extractDpopThumbprint(request);
  if (!dpopJkt) {
    return;
  }

  await db
    .update(oauthAccessTokens)
    .set({ confirmation: JSON.stringify({ jkt: dpopJkt }) })
    .where(eq(oauthAccessTokens.token, hashOpaqueAccessToken(token)))
    .run();
}

export async function validateOpaqueAccessTokenDpop(
  request: Request,
  dpopJkt: string
): Promise<boolean> {
  try {
    await dpopValidator({
      request,
      tokenPayload: { cnf: { jkt: dpopJkt } },
    });
    return true;
  } catch {
    return false;
  }
}
