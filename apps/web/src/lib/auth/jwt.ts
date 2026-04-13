import "server-only";

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JWTPayload,
  jwtVerify,
} from "jose";

import { env } from "@/env";
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
