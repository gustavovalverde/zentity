import "server-only";

import { createRemoteJWKSet } from "jose";

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
