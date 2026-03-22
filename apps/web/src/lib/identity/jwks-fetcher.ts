import "server-only";

import { createRemoteJWKSet } from "jose";

import { env } from "@/env";
import { logger } from "@/lib/logging/logger";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MB

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

/**
 * Validates that a raw fetch to the JWKS URL respects size and redirect limits.
 */
export async function validateJwksEndpoint(jwksUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(jwksUrl);
  } catch {
    return false;
  }

  if (!isDevMode()) {
    if (isPrivateUrl(url)) {
      return false;
    }
    if (url.protocol !== "https:") {
      return false;
    }
  }

  try {
    const response = await fetch(jwksUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return false;
    }

    const contentLength = response.headers.get("content-length");
    if (
      contentLength &&
      Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES
    ) {
      logger.warn(
        { jwksUrl, contentLength },
        "JWKS response exceeds size limit"
      );
      return false;
    }

    // Verify redirect destination isn't private
    const finalUrl = new URL(response.url);
    if (
      finalUrl.origin !== url.origin &&
      !isDevMode() &&
      isPrivateUrl(finalUrl)
    ) {
      logger.warn(
        { jwksUrl, finalUrl: response.url },
        "JWKS redirected to private address"
      );
      return false;
    }

    return true;
  } catch (err) {
    logger.warn({ err, jwksUrl }, "JWKS endpoint validation failed");
    return false;
  }
}

/** Clear the JWKS cache (for testing). */
export function clearJwksCache(): void {
  cache.clear();
}
