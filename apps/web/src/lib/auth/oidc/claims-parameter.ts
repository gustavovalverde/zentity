/**
 * OIDC Claims Parameter (Section 5.5) bridge.
 *
 * The oauth-provider plugin stores the `claims` parameter in the auth code
 * verification record but never forwards it to customIdTokenClaims/
 * customUserInfoClaims hooks. This module bridges the gap:
 *
 * 1. Before token exchange, extract `claims` from the verification record
 * 2. Store it in a process-scoped Map keyed by userId:clientId
 * 3. In the custom claims hooks, consume and filter claims accordingly
 */

/** Parsed claims request for a single endpoint (id_token or userinfo). */
type ClaimsRequest = Record<
  string,
  null | {
    essential?: boolean;
    value?: unknown;
    values?: unknown[];
  }
>;

interface ParsedClaimsParameter {
  id_token?: ClaimsRequest | undefined;
  userinfo?: ClaimsRequest | undefined;
}

const CLAIMS_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ClaimsEntry {
  claims: ParsedClaimsParameter;
  expiresAt: number;
}

const STORE_KEY = Symbol.for("zentity.claims-parameter");

function getStore(): Map<string, ClaimsEntry> {
  const g = globalThis as Record<symbol, Map<string, ClaimsEntry>>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map();
  }
  return g[STORE_KEY];
}

function evictExpired(): void {
  const now = Date.now();
  const s = getStore();
  for (const [key, entry] of s) {
    if (entry.expiresAt <= now) {
      s.delete(key);
    }
  }
}

function getEntry(key: string): ClaimsEntry | null {
  const s = getStore();
  const entry = s.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    s.delete(key);
    return null;
  }
  return entry;
}

/** Store a parsed claims parameter keyed by userId + clientId. */
export function stageClaimsParameter(
  userId: string,
  clientId: string,
  claims: ParsedClaimsParameter
): void {
  evictExpired();
  getStore().set(`${userId}:${clientId}`, {
    claims,
    expiresAt: Date.now() + CLAIMS_TTL_MS,
  });
}

function resolveKey(userId: string, clientId?: string): string | null {
  if (!clientId) {
    return null;
  }
  return `${userId}:${clientId}`;
}

/**
 * Consume the id_token portion of the claims parameter.
 * Leaves the userinfo portion intact for a subsequent userinfo call.
 */
export function consumeIdTokenClaims(
  userId: string,
  clientId?: string
): ClaimsRequest | undefined {
  const key = resolveKey(userId, clientId);
  if (!key) {
    return undefined;
  }
  const entry = getEntry(key);
  if (!entry) {
    return undefined;
  }
  const idTokenClaims = entry.claims.id_token;
  entry.claims.id_token = undefined;
  if (!entry.claims.userinfo) {
    getStore().delete(key);
  }
  return idTokenClaims;
}

/**
 * Consume the userinfo portion of the claims parameter.
 * Deletes the entry entirely (terminal consumer).
 */
export function consumeUserinfoClaims(
  userId: string,
  clientId?: string
): ClaimsRequest | undefined {
  const key = resolveKey(userId, clientId);
  if (!key) {
    return undefined;
  }
  const entry = getEntry(key);
  if (!entry) {
    return undefined;
  }
  const userinfoClaims = entry.claims.userinfo;
  getStore().delete(key);
  return userinfoClaims;
}

/**
 * Parse the raw `claims` JSON string from the authorization request.
 * Returns null if absent, empty, or malformed.
 */
export function parseClaimsParameter(
  raw: unknown
): ParsedClaimsParameter | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const result: ParsedClaimsParameter = {};

    if (isClaimsRequest(parsed.id_token)) {
      result.id_token = parsed.id_token;
    }
    if (isClaimsRequest(parsed.userinfo)) {
      result.userinfo = parsed.userinfo;
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function isClaimsRequest(v: unknown): v is ClaimsRequest {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Filter a claims object to only include claims requested for a specific endpoint.
 * If no claims parameter was provided, returns the full claims object unchanged.
 */
export function filterClaimsByRequest(
  allClaims: Record<string, unknown>,
  requested: ClaimsRequest | undefined
): Record<string, unknown> {
  if (!requested) {
    return allClaims;
  }

  const filtered: Record<string, unknown> = {};

  for (const [claimName, constraint] of Object.entries(requested)) {
    if (!(claimName in allClaims)) {
      continue;
    }

    const value = allClaims[claimName];

    // null means "please return this claim with no constraints"
    if (constraint === null) {
      filtered[claimName] = value;
      continue;
    }

    // Check value constraint
    if (constraint.value !== undefined && value !== constraint.value) {
      continue;
    }

    // Check values constraint
    if (constraint.values !== undefined && !constraint.values.includes(value)) {
      continue;
    }

    filtered[claimName] = value;
  }

  return filtered;
}
