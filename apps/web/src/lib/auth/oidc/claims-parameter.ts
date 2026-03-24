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
  id_token?: ClaimsRequest | undefined;
  userinfo?: ClaimsRequest | undefined;
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
