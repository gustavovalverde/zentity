/**
 * Shared sliding-window rate limiter.
 *
 * In-memory Map keyed by caller identity (IP, session, user, etc.).
 * Each entry tracks request timestamps within the sliding window.
 * A periodic cleanup interval prunes stale entries.
 */

export interface RateLimitResult {
  limited: boolean;
  retryAfter?: number;
}

export interface RateLimiterOptions {
  /** Maximum requests allowed per window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

interface WindowEntry {
  timestamps: number[];
}

export interface RateLimiter {
  /** Check if a key is rate-limited. Records the request timestamp. */
  check(key: string): RateLimitResult;
  /** Stop the cleanup interval. */
  destroy(): void;
  /** Clear all tracked entries (for testing). */
  reset(): void;
  /** Number of tracked keys (for testing). */
  readonly size: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, max } = options;
  const store = new Map<string, WindowEntry>();

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of store) {
      const filtered = entry.timestamps.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        store.delete(key);
      } else {
        entry.timestamps = filtered;
      }
    }
  }, windowMs);

  // Allow Node.js to exit even if the interval is still running
  if (typeof cleanup === "object" && "unref" in cleanup) {
    cleanup.unref();
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const cutoff = now - windowMs;
      const entry = store.get(key);
      const timestamps = entry
        ? entry.timestamps.filter((t) => t > cutoff)
        : [];

      timestamps.push(now);

      if (entry) {
        entry.timestamps = timestamps;
      } else {
        store.set(key, { timestamps });
      }

      if (timestamps.length > max) {
        const oldestInWindow = timestamps[0] ?? now;
        const retryAfter = Math.ceil((oldestInWindow + windowMs - now) / 1000);
        return { limited: true, retryAfter: Math.max(retryAfter, 1) };
      }

      return { limited: false };
    },

    get size() {
      return store.size;
    },

    reset() {
      store.clear();
    },

    destroy() {
      clearInterval(cleanup);
      store.clear();
    },
  };
}

/** Extract client IP from request headers. */
export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Create a 429 JSON response with Retry-After header. */
export function rateLimitResponse(retryAfter = 60): Response {
  return Response.json(
    { error: "too_many_requests", message: "Rate limit exceeded" },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    }
  );
}
