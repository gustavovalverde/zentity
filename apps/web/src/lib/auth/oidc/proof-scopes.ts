/**
 * Proof Scope Definitions
 *
 * Maps OAuth scopes to verification status claims shared with RPs.
 * These proof:* scopes control which derived/boolean verification flags
 * an RP receives — no PII is involved.
 *
 * `proof:identity` is the umbrella scope that grants all proof claims.
 * Granular sub-scopes allow minimal disclosure (e.g., wine shop
 * only needs `proof:verification proof:age`).
 */

import type { PROOF_DISCLOSURE_KEYS } from "./claims";

type ProofClaimKey = (typeof PROOF_DISCLOSURE_KEYS)[number];

export const PROOF_SCOPES = [
  "proof:verification",
  "proof:age",
  "proof:document",
  "proof:liveness",
  "proof:nationality",
  "proof:compliance",
] as const;

export type ProofScope = (typeof PROOF_SCOPES)[number];

export function isProofScope(scope: string): scope is ProofScope {
  return PROOF_SCOPES.includes(scope as ProofScope);
}

const PROOF_SCOPE_CLAIMS: Record<ProofScope, ProofClaimKey[]> = {
  "proof:verification": ["verification_level", "verified"],
  "proof:age": ["age_proof_verified"],
  "proof:document": ["document_verified", "doc_validity_proof_verified"],
  "proof:liveness": ["liveness_verified", "face_match_verified"],
  "proof:nationality": ["nationality_proof_verified"],
  "proof:compliance": [
    "policy_version",
    "issuer_id",
    "verification_time",
    "attestation_expires_at",
  ],
};

export const PROOF_SCOPE_DESCRIPTIONS: Record<ProofScope, string> = {
  "proof:verification": "Identity verification status",
  "proof:age": "Proof you meet the age requirement",
  "proof:document": "Document verification status",
  "proof:liveness": "Liveness and photo match results",
  "proof:nationality": "Nationality verification",
  "proof:compliance": "Verification policy and timestamps",
};

export function extractProofScopes(scopes: string[]): ProofScope[] {
  return scopes.filter(isProofScope);
}

/**
 * Get allowed proof claim keys based on requested scopes.
 * `proof:identity` expands to all proof claims.
 */
function getProofClaimKeys(scopes: string[]): Set<ProofClaimKey> {
  if (scopes.includes("proof:identity")) {
    return new Set(Object.values(PROOF_SCOPE_CLAIMS).flat());
  }

  const keys = new Set<ProofClaimKey>();
  for (const scope of extractProofScopes(scopes)) {
    for (const key of PROOF_SCOPE_CLAIMS[scope]) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Filter proof claims to only include those allowed by requested scopes.
 */
export function filterProofClaimsByScopes(
  claims: Record<string, unknown>,
  scopes: string[]
): Record<string, unknown> {
  const allowedKeys = getProofClaimKeys(scopes);
  const filtered: Record<string, unknown> = {};

  for (const key of allowedKeys) {
    if (key in claims && claims[key] !== undefined) {
      filtered[key] = claims[key];
    }
  }

  return filtered;
}
