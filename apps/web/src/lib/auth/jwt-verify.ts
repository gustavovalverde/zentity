import "server-only";

import { createLocalJWKSet, type JWTPayload, jwtVerify } from "jose";

import { env } from "@/env";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { jwks as jwksTable } from "@/lib/db/schema/oauth-provider";

const authIssuer = getAuthIssuer();
const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");

async function getLocalJwks() {
  const rows = await db.select().from(jwksTable).all();
  const keys = rows.map((row) => {
    const pub = JSON.parse(row.publicKey) as Record<string, unknown>;
    return { ...pub, kid: row.id, ...(row.alg ? { alg: row.alg } : {}) };
  });
  return createLocalJWKSet({ keys });
}

export async function verifyAuthIssuedJwt(
  token: string
): Promise<JWTPayload | null> {
  try {
    const jwks = await getLocalJwks();
    const { payload } = await jwtVerify(token, jwks, { issuer: authIssuer });
    return payload;
  } catch {
    return null;
  }
}

export async function verifyAccessToken(
  token: string
): Promise<JWTPayload | null> {
  try {
    const payload = await verifyAuthIssuedJwt(token);
    if (!payload) {
      return null;
    }
    if (payload.sub) {
      const jwks = await getLocalJwks();
      await jwtVerify(token, jwks, {
        issuer: authIssuer,
        audience: [appUrl, authIssuer],
      });
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}
