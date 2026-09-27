import "server-only";

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyOptions,
  errors as joseErrors,
  jwtVerify,
} from "jose";

import { env } from "@/env";
import { isTokenRevoked } from "@/lib/auth/oidc/token-revocation";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { jwks as jwksTable } from "@/lib/db/schema/oauth-provider";
import { logger } from "@/lib/logging/logger";

// ── Remote JWKS (hardened) ─────────────────────────────────────────────

const REMOTE_CACHE_TTL_MS = 60 * 60 * 1000;
const REMOTE_FETCH_TIMEOUT_MS = 5000;
const PRIVATE_IP_RE =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|::1|fc|fd|fe80)/;

type RemoteJWKSet = ReturnType<typeof createRemoteJWKSet>;

const remoteJwksCache = new Map<
  string,
  { fetchedAt: number; jwks: RemoteJWKSet }
>();

function isPrivateUrl(url: URL): boolean {
  return PRIVATE_IP_RE.test(url.hostname) || url.hostname === "localhost";
}

function isDevMode(): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

// Fetch a remote JWKS with security hardening: block private/loopback IPs
// in production, HTTPS-only in production (localhost exempt in dev),
// 5s timeout, 1h cache.
export function getHardenedJWKSet(jwksUrl: string): RemoteJWKSet | null {
  const cached = remoteJwksCache.get(jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < REMOTE_CACHE_TTL_MS) {
    return cached.jwks;
  }

  let url: URL;
  try {
    url = new URL(jwksUrl);
  } catch {
    logger.warn({ jwksUrl }, "Invalid JWKS URL");
    return null;
  }

  if (!isDevMode()) {
    if (isPrivateUrl(url)) {
      logger.warn({ jwksUrl }, "JWKS URL points to private/loopback address");
      return null;
    }
    if (url.protocol !== "https:") {
      logger.warn({ jwksUrl }, "JWKS URL must use HTTPS in production");
      return null;
    }
  }

  const jwks = createRemoteJWKSet(url, {
    timeoutDuration: REMOTE_FETCH_TIMEOUT_MS,
    headers: { Accept: "application/json" },
  });

  remoteJwksCache.set(jwksUrl, { fetchedAt: Date.now(), jwks });
  return jwks;
}

// ── Locally-issued JWT verification ────────────────────────────────────

const authIssuer = getAuthIssuer();
const LOCAL_KEY_SET_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TYP = "at+jwt";

type LocalKeySet = ReturnType<typeof createLocalJWKSet>;

let localKeySet: { expiresAt: number; keys: LocalKeySet } | null = null;

async function loadLocalKeySet(refresh: boolean): Promise<LocalKeySet> {
  if (!refresh && localKeySet && localKeySet.expiresAt > Date.now()) {
    return localKeySet.keys;
  }
  const rows = await db.select().from(jwksTable).all();
  const keys = createLocalJWKSet({
    keys: rows.map((row) => {
      const pub = JSON.parse(row.publicKey) as Record<string, unknown>;
      return { ...pub, kid: row.id, ...(row.alg ? { alg: row.alg } : {}) };
    }),
  });
  localKeySet = { expiresAt: Date.now() + LOCAL_KEY_SET_TTL_MS, keys };
  return keys;
}

export function invalidateLocalKeySet(): void {
  localKeySet = null;
}

async function verifyWithLocalKeys(
  token: string,
  options: JWTVerifyOptions
): Promise<JWTPayload> {
  try {
    return (await jwtVerify(token, await loadLocalKeySet(false), options))
      .payload;
  } catch (error) {
    if (!(error instanceof joseErrors.JWKSNoMatchingKey)) {
      throw error;
    }
    return (await jwtVerify(token, await loadLocalKeySet(true), options))
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

export async function verifyIssuedAccessToken(
  token: string,
  audience?: string | string[]
): Promise<JWTPayload | null> {
  const payload = await verifyAuthIssuedJwt(token, {
    typ: ACCESS_TOKEN_TYP,
    ...(audience ? { audience } : {}),
  });
  if (!(payload && typeof payload.jti === "string")) {
    return null;
  }
  return (await isTokenRevoked(payload.jti)) ? null : payload;
}
