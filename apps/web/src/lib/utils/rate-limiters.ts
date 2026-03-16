/**
 * Pre-configured rate limiter instances for API routes.
 *
 * Each limiter is a singleton — import and call `.check(key)` in route handlers.
 * Key strategies:
 * - IP-based: for public/unauthenticated endpoints
 * - Session-based: for authenticated endpoints where session ID is available
 * - User-based: for endpoints where user ID is the natural key
 */
import { createRateLimiter } from "./rate-limit";

const MINUTE = 60_000;

/** OCR proxy: 5 req/min per session. */
export const ocrLimiter = createRateLimiter({ windowMs: MINUTE, max: 5 });

/** FHE endpoints: 10 req/min per session. */
export const fheLimiter = createRateLimiter({ windowMs: MINUTE, max: 10 });

/** CIBA endpoints: 20 req/min per user. */
export const cibaLimiter = createRateLimiter({ windowMs: MINUTE, max: 20 });

/** ZK proof verification: 5 req/min per session. */
export const zkLimiter = createRateLimiter({ windowMs: MINUTE, max: 5 });

/** OAuth2 identity endpoints: 10 req/min per session. */
export const oauth2IdentityLimiter = createRateLimiter({
  windowMs: MINUTE,
  max: 10,
});

/** Secrets blob: 10 req/min per session. */
export const secretsBlobLimiter = createRateLimiter({
  windowMs: MINUTE,
  max: 10,
});

/** Public endpoints (logging, metrics, pwned): 30 req/min per IP. */
export const publicLimiter = createRateLimiter({ windowMs: MINUTE, max: 30 });
