/**
 * TTL Cache Utilities
 *
 * Provides consistent caching patterns with time-to-live expiration
 * for credential materials and other sensitive data.
 */

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

/**
 * A simple TTL cache for a single value.
 *
 * @example
 * const cache = createTtlCache<FheKeys>(15 * 60 * 1000);
 * cache.set(keys);
 * const cached = cache.get(); // null if expired
 */
export function createTtlCache<T>(ttlMs: number) {
  let entry: CacheEntry<T> | null = null;

  return {
    get(): T | null {
      if (!entry) {
        return null;
      }
      if (Date.now() - entry.cachedAt > ttlMs) {
        entry = null;
        return null;
      }
      return entry.value;
    },

    set(value: T): void {
      entry = { value, cachedAt: Date.now() };
    },

    clear(): void {
      entry = null;
    },

    /**
     * Check if cache has a value without retrieving it.
     * Returns false if expired.
     */
    has(): boolean {
      if (!entry) {
        return false;
      }
      if (Date.now() - entry.cachedAt > ttlMs) {
        entry = null;
        return false;
      }
      return true;
    },

    /**
     * Get raw entry including cachedAt for custom validation.
     * Returns null if no entry exists (does NOT check TTL).
     */
    getRaw(): CacheEntry<T> | null {
      return entry;
    },
  };
}

/**
 * A TTL cache with custom validation.
 * Useful when cached values need additional checks beyond TTL (e.g., userId match).
 *
 * @example
 * const cache = createValidatedTtlCache<OpaqueExport, string>(
 *   15 * 60 * 1000,
 *   (entry, userId) => entry.userId === userId
 * );
 * cache.set({ userId, exportKey });
 * const cached = cache.get(userId); // null if expired OR userId mismatch
 */
export function createValidatedTtlCache<T, K>(
  ttlMs: number,
  validate: (value: T, key: K) => boolean
) {
  let entry: CacheEntry<T> | null = null;

  return {
    get(key: K): T | null {
      if (!entry) {
        return null;
      }
      if (Date.now() - entry.cachedAt > ttlMs) {
        entry = null;
        return null;
      }
      if (!validate(entry.value, key)) {
        return null;
      }
      return entry.value;
    },

    set(value: T): void {
      entry = { value, cachedAt: Date.now() };
    },

    clear(): void {
      entry = null;
    },

    /**
     * Check if cache has a valid value for the given key.
     */
    has(key: K): boolean {
      if (!entry) {
        return false;
      }
      if (Date.now() - entry.cachedAt > ttlMs) {
        entry = null;
        return false;
      }
      return validate(entry.value, key);
    },

    /**
     * Get raw entry for custom access (does NOT check TTL or validate).
     */
    getRaw(): CacheEntry<T> | null {
      return entry;
    },
  };
}

/**
 * A TTL cache keyed by string for tracking in-flight operations.
 * Automatically cleans up expired entries on access.
 *
 * @example
 * const inFlight = createKeyedTtlCache<Promise<Result>>(60_000);
 * inFlight.set("challenge:age", pendingRequest);
 * const existing = inFlight.get("challenge:age");
 */
export function createKeyedTtlCache<V>(ttlMs: number) {
  const entries = new Map<string, CacheEntry<V>>();

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now - entry.cachedAt > ttlMs) {
        entries.delete(key);
      }
    }
  }

  return {
    get(key: string): V | null {
      cleanup();
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }
      if (Date.now() - entry.cachedAt > ttlMs) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },

    set(key: string, value: V): void {
      cleanup();
      entries.set(key, { value, cachedAt: Date.now() });
    },

    delete(key: string): boolean {
      return entries.delete(key);
    },

    clear(): void {
      entries.clear();
    },

    has(key: string): boolean {
      cleanup();
      const entry = entries.get(key);
      if (!entry) {
        return false;
      }
      if (Date.now() - entry.cachedAt > ttlMs) {
        entries.delete(key);
        return false;
      }
      return true;
    },
  };
}
