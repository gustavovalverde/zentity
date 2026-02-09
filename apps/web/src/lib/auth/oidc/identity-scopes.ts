/**
 * Identity Scope Definitions (RFC-0025)
 *
 * Maps OAuth scopes to identity claims that can be shared with RPs.
 * These identity.* scopes are explicit PII disclosures (no implicit expansion).
 */

/**
 * Identity fields that can be shared via OAuth.
 * Matches OIDC standard claims + Zentity-specific fields.
 */
export interface IdentityFields {
  given_name?: string;
  family_name?: string;
  name?: string;
  birthdate?: string;
  address?: {
    formatted?: string;
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  document_number?: string;
  document_type?: string;
  issuing_country?: string;
  nationality?: string;
  nationalities?: string[];
}

/**
 * All identity-related scopes.
 */
export const IDENTITY_SCOPES = [
  "identity.name",
  "identity.dob",
  "identity.address",
  "identity.document",
  "identity.nationality",
] as const;

export type IdentityScope = (typeof IDENTITY_SCOPES)[number];

/**
 * Check if a scope is an identity scope.
 */
export function isIdentityScope(scope: string): scope is IdentityScope {
  return IDENTITY_SCOPES.includes(scope as IdentityScope);
}

/**
 * Mapping of identity scopes to the claims they unlock.
 */
export const IDENTITY_SCOPE_CLAIMS: Record<
  IdentityScope,
  (keyof IdentityFields)[]
> = {
  "identity.name": ["given_name", "family_name", "name"],
  "identity.dob": ["birthdate"],
  "identity.address": ["address"],
  "identity.document": ["document_number", "document_type", "issuing_country"],
  "identity.nationality": ["nationality", "nationalities"],
};

/**
 * Human-readable descriptions for consent UI.
 */
export const IDENTITY_SCOPE_DESCRIPTIONS: Record<IdentityScope, string> = {
  "identity.name": "Full legal name",
  "identity.dob": "Date of birth",
  "identity.address": "Residential address",
  "identity.document": "Document details (number, type, country)",
  "identity.nationality": "Nationality",
};

/**
 * Extract identity scopes from a list of scopes.
 */
export function extractIdentityScopes(scopes: string[]): IdentityScope[] {
  return scopes.filter(isIdentityScope);
}

/**
 * Check if the "identity" convenience scope is present and expand it.
 * Returns deduplicated list of specific identity scopes.
 */
export function expandIdentityScopes(scopes: string[]): IdentityScope[] {
  const identityScopes = extractIdentityScopes(scopes);

  return identityScopes;
}

/**
 * Get all claim keys that should be included based on consented scopes.
 */
export function getConsentedClaimKeys(
  consentedScopes: string[]
): (keyof IdentityFields)[] {
  const expandedScopes = expandIdentityScopes(consentedScopes);
  const claimKeys = new Set<keyof IdentityFields>();

  for (const scope of expandedScopes) {
    const claims = IDENTITY_SCOPE_CLAIMS[scope];
    for (const claim of claims) {
      claimKeys.add(claim);
    }
  }

  return Array.from(claimKeys);
}

/**
 * Filter identity fields to only include those allowed by consented scopes.
 */
export function filterIdentityByScopes(
  identity: IdentityFields,
  consentedScopes: string[]
): Partial<IdentityFields> {
  const allowedKeys = getConsentedClaimKeys(consentedScopes);
  const filtered: Partial<IdentityFields> = {};

  for (const key of allowedKeys) {
    if (key in identity && identity[key] !== undefined) {
      (filtered as Record<string, unknown>)[key] = identity[key];
    }
  }

  return filtered;
}
