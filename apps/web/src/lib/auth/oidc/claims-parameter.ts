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
export type ClaimsRequest = Record<
  string,
  null | {
    essential?: boolean;
    value?: unknown;
    values?: unknown[];
  }
>;

export interface ParsedClaimsParameter {
  id_token?: ClaimsRequest;
  userinfo?: ClaimsRequest;
}

const pendingClaims = new Map<string, ParsedClaimsParameter>();

/** Store a parsed claims parameter for a user during token exchange. */
export function stageClaimsParameter(
  userId: string,
  claims: ParsedClaimsParameter
): void {
  pendingClaims.set(userId, claims);
}

/** Peek at the staged claims parameter without consuming it. */
export function peekClaimsParameter(
  userId: string
): ParsedClaimsParameter | null {
  return pendingClaims.get(userId) ?? null;
}

/** Consume the staged claims parameter (one-time use). */
export function consumeClaimsParameter(
  userId: string
): ParsedClaimsParameter | null {
  const claims = pendingClaims.get(userId) ?? null;
  pendingClaims.delete(userId);
  return claims;
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
