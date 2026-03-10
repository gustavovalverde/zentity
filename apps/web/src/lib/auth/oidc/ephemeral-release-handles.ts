import "server-only";

/**
 * Ephemeral in-memory store for release handles.
 *
 * During CIBA approval, the sealed PII's release handle is staged here.
 * When the CIBA grant handler mints the access token, customAccessTokenClaims
 * consumes the handle from this store and embeds it in the JWT.
 *
 * The handle has a short TTL — if the token endpoint isn't called within
 * 5 minutes, the handle expires and the RP won't get PII.
 */

interface ReleaseHandleEntry {
  expiresAt: number;
  releaseHandle: string;
}

const TTL_MS = 5 * 60 * 1000;

const STORE_KEY = Symbol.for("zentity.ephemeral-release-handles");

function getStore(): Map<string, ReleaseHandleEntry> {
  const g = globalThis as Record<symbol, Map<string, ReleaseHandleEntry>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map();
  }
  return g[STORE_KEY];
}

/**
 * Stage a release handle for embedding in the next access token.
 * Keyed by userId — only one pending approval per user at a time.
 */
export function stageReleaseHandle(
  userId: string,
  releaseHandle: string
): void {
  getStore().set(userId, {
    releaseHandle,
    expiresAt: Date.now() + TTL_MS,
  });
}

/**
 * Consume the staged release handle (single-use).
 * Called by customAccessTokenClaims during token minting.
 */
export function consumeReleaseHandle(userId: string): string | null {
  const store = getStore();
  const entry = store.get(userId);
  if (!entry) {
    return null;
  }
  store.delete(userId);
  if (entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry.releaseHandle;
}

/**
 * Clear all staged release handles (for tests).
 */
export function resetReleaseHandleStore(): void {
  getStore().clear();
}
