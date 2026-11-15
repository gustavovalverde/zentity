import "server-only";

import { eq } from "drizzle-orm";
import {
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyOptions,
  errors as joseErrors,
  jwtVerify,
} from "jose";

import { getLocalKeySet } from "@/lib/auth/oidc/jwt-signer";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { revokedTokens } from "@/lib/db/schema/revoked-tokens";
import { validateOutboundUrl } from "@/lib/http/url-safety";
import { logger } from "@/lib/logging/logger";

// ── Remote JWKS (hardened) ─────────────────────────────────────────────

const REMOTE_FETCH_TIMEOUT_MS = 5000;
type RemoteJWKSet = ReturnType<typeof createRemoteJWKSet>;

const remoteJwksCache = new Map<string, RemoteJWKSet>();

// One remote JWKS per validated outbound URL, fetched with a 5s timeout. jose
// caches the keys, refetching them after its `cacheMaxAge` or for an unknown
// `kid` once its cooldown has passed.
export function getHardenedJWKSet(jwksUrl: string): RemoteJWKSet | null {
  const cached = remoteJwksCache.get(jwksUrl);
  if (cached) {
    return cached;
  }

  const problem = validateOutboundUrl(jwksUrl);
  if (problem) {
    logger.warn({ jwksUrl, problem }, "JWKS URL rejected");
    return null;
  }

  const url = new URL(jwksUrl);
  const jwks = createRemoteJWKSet(url, {
    timeoutDuration: REMOTE_FETCH_TIMEOUT_MS,
    headers: { Accept: "application/json" },
  });

  remoteJwksCache.set(jwksUrl, jwks);
  return jwks;
}

// ── Locally-issued JWT verification ────────────────────────────────────

const authIssuer = getAuthIssuer();

async function verifyWithLocalKeys(
  token: string,
  options: JWTVerifyOptions
): Promise<JWTPayload> {
  try {
    return (await jwtVerify(token, await getLocalKeySet(), options)).payload;
  } catch (error) {
    if (!(error instanceof joseErrors.JWKSNoMatchingKey)) {
      throw error;
    }
    return (await jwtVerify(token, await getLocalKeySet(true), options))
      .payload;
  }
}

/**
 * Verifies a JWT this issuer signed. `typ` is required so one kind of token
 * (an ID token, a logout token) is never accepted as another.
 */
export async function verifyAuthIssuedJwt(
  token: string,
  options: { audience?: string | string[]; typ: string }
): Promise<JWTPayload | null> {
  try {
    return await verifyWithLocalKeys(token, {
      issuer: authIssuer,
      typ: options.typ,
      ...(options.audience ? { audience: options.audience } : {}),
    });
  } catch {
    return null;
  }
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  const row = await db
    .select({ jti: revokedTokens.jti })
    .from(revokedTokens)
    .where(eq(revokedTokens.jti, jti))
    .limit(1)
    .get();
  return Boolean(row);
}
