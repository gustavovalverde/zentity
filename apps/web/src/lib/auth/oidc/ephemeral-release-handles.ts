import "server-only";

/**
 * Ephemeral in-memory store for release handles.
 *
 * Handles are keyed by authReqId (CIBA request scoped) with a reverse
 * index from userId → Set<authReqId> so customAccessTokenClaims can
 * look up the right handle without knowing the authReqId.
 *
 * The handle has a short TTL — if the token endpoint isn't called within
 * 5 minutes, the handle expires and the RP won't get PII.
 */

interface ReleaseHandleEntry {
  expiresAt: number;
  releaseHandle: string;
  userId: string;
}

const TTL_MS = 5 * 60 * 1000;

const STORE_KEY = Symbol.for("zentity.ephemeral-release-handles");
const INDEX_KEY = Symbol.for("zentity.ephemeral-release-handles.user-index");

function getStore(): Map<string, ReleaseHandleEntry> {
  const g = globalThis as Record<symbol, Map<string, ReleaseHandleEntry>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map();
  }
  return g[STORE_KEY];
}

function getUserIndex(): Map<string, Set<string>> {
  const g = globalThis as Record<symbol, Map<string, Set<string>>>;
  if (!g[INDEX_KEY]) {
    g[INDEX_KEY] = new Map();
  }
  return g[INDEX_KEY];
}

/**
 * Stage a release handle for embedding in the next CIBA access token.
 * Keyed by authReqId — each CIBA request gets its own handle.
 */
export function stageReleaseHandle(
  authReqId: string,
  releaseHandle: string,
  userId: string
): void {
  getStore().set(authReqId, {
    releaseHandle,
    expiresAt: Date.now() + TTL_MS,
    userId,
  });
  const index = getUserIndex();
  let set = index.get(userId);
  if (!set) {
    set = new Set();
    index.set(userId, set);
  }
  set.add(authReqId);
}

/**
 * Consume a staged release handle for a specific CIBA request (single-use).
 *
 * When authReqId is provided (patched CIBA plugin), looks up directly by
 * request ID — guaranteeing the correct handle for concurrent approvals.
 * Falls back to userId-based iteration when authReqId is unavailable.
 */
export function consumeReleaseHandle(
  userId: string,
  authReqId?: string
): string | null {
  const store = getStore();
  const index = getUserIndex();

  if (authReqId) {
    const entry = store.get(authReqId);
    if (!entry || entry.userId !== userId) {
      return null;
    }
    store.delete(authReqId);
    const userSet = index.get(userId);
    if (userSet) {
      userSet.delete(authReqId);
      if (userSet.size === 0) {
        index.delete(userId);
      }
    }
    return entry.expiresAt > Date.now() ? entry.releaseHandle : null;
  }

  const authReqIds = index.get(userId);
  if (!authReqIds || authReqIds.size === 0) {
    return null;
  }

  for (const reqId of authReqIds) {
    const entry = store.get(reqId);
    if (!entry) {
      authReqIds.delete(reqId);
      continue;
    }
    store.delete(reqId);
    authReqIds.delete(reqId);
    if (authReqIds.size === 0) {
      index.delete(userId);
    }
    if (entry.expiresAt <= Date.now()) {
      continue;
    }
    return entry.releaseHandle;
  }

  index.delete(userId);
  return null;
}

/**
 * Clear all staged release handles (for tests).
 */
export function resetReleaseHandleStore(): void {
  getStore().clear();
  getUserIndex().clear();
}
