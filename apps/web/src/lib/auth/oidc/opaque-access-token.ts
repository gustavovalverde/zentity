import "server-only";

import { createHash } from "node:crypto";

import { createDpopAccessTokenValidator } from "@better-auth/haip";
import { eq } from "drizzle-orm";
import { calculateJwkThumbprint, decodeProtectedHeader } from "jose";

import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";

const dpopValidator = createDpopAccessTokenValidator({ requireDpop: false });

interface OpaqueAccessTokenRecord {
  clientId: string;
  dpopJkt: string | null;
  expiresAt: Date;
  referenceId: string | null;
  scopes: string[];
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

export async function loadOpaqueAccessToken(
  token: string
): Promise<OpaqueAccessTokenRecord | null> {
  const row = await db
    .select({
      clientId: oauthAccessTokens.clientId,
      dpopJkt: oauthAccessTokens.dpopJkt,
      expiresAt: oauthAccessTokens.expiresAt,
      referenceId: oauthAccessTokens.referenceId,
      scopes: oauthAccessTokens.scopes,
      userId: oauthAccessTokens.userId,
    })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, hashOpaqueAccessToken(token)))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  return {
    ...row,
    scopes: parseStoredStringArray(row.scopes),
  };
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
    .set({ dpopJkt })
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
