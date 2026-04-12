import "server-only";

import { createRemoteJWKSet } from "jose";

import { env } from "@/env";
import { logger } from "@/lib/logging/logger";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5000;
const PRIVATE_IP_RE =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|::1|fc|fd|fe80)/;

type RemoteJWKSet = ReturnType<typeof createRemoteJWKSet>;

const cache = new Map<string, { fetchedAt: number; jwks: RemoteJWKSet }>();

function isPrivateUrl(url: URL): boolean {
  return PRIVATE_IP_RE.test(url.hostname) || url.hostname === "localhost";
}

function isDevMode(): boolean {
  return env.NODE_ENV === "development" || env.NODE_ENV === "test";
}

/**
 * Fetch a remote JWKS with security hardening:
 * - Block private/loopback IPs in production
 * - HTTPS-only in production (localhost exempt in dev)
 * - 5s timeout, 1h cache
 */
export function getHardenedJWKSet(jwksUrl: string): RemoteJWKSet | null {
  const cached = cache.get(jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
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
    timeoutDuration: FETCH_TIMEOUT_MS,
    headers: { Accept: "application/json" },
  });

  cache.set(jwksUrl, { fetchedAt: Date.now(), jwks });
  return jwks;
}
