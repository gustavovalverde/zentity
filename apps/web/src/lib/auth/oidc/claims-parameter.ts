/**
 * OIDC Claims Parameter (Section 5.5) bridge.
 *
 * The oauth-provider plugin stores the `claims` parameter in the auth code
 * verification record but never forwards it to customIdTokenClaims/
 * customUserInfoClaims hooks. This module bridges the gap:
 *
 * 1. Before token exchange, extract `claims` from the verification record
 * 2. Store it in a module-scoped Map keyed by userId
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

const pendingClaims = new Map<string, ClaimsEntry>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of pendingClaims) {
    if (entry.expiresAt <= now) {
      pendingClaims.delete(key);
    }
  }
}

function getEntry(userId: string): ClaimsEntry | null {
  const entry = pendingClaims.get(userId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    pendingClaims.delete(userId);
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
  pendingClaims.set(`${userId}:${clientId}`, {
    claims,
    expiresAt: Date.now() + CLAIMS_TTL_MS,
  });
}

/**
 * Resolve the composite key for a user.
 * If clientId is provided, use it directly. Otherwise, prefix-scan for a
 * unique match (same pattern as ephemeral-identity-claims.ts).
 */
function resolveKey(userId: string, clientId?: string): string | null {
  if (clientId) {
    return `${userId}:${clientId}`;
  }
  const prefix = `${userId}:`;
  const matches: string[] = [];
  for (const key of pendingClaims.keys()) {
    if (key.startsWith(prefix)) {
      matches.push(key);
    }
  }
  return (matches.length === 1 ? matches[0] : null) ?? null;
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
    pendingClaims.delete(key);
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
  pendingClaims.delete(key);
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

/**
 * Check if any essential claims cannot be satisfied.
 * Returns the name of the first unsatisfiable essential claim, or null.
 */
export function findUnsatisfiableEssentialClaim(
  claims: ParsedClaimsParameter,
  supportedClaimNames: Set<string>
): string | null {
  for (const endpoint of [claims.id_token, claims.userinfo]) {
    if (!endpoint) {
      continue;
    }
    for (const [claimName, constraint] of Object.entries(endpoint)) {
      if (
        constraint !== null &&
        constraint.essential === true &&
        !supportedClaimNames.has(claimName)
      ) {
        return claimName;
      }
    }
  }
  return null;
}
