/**
 * VC (Verifiable Credential) Scope Definitions
 *
 * Maps OAuth scopes to verification status claims shared with RPs.
 * These vc:* scopes control which derived/boolean verification flags
 * an RP receives — no PII is involved.
 *
 * `vc:identity` is the umbrella scope that grants all VC claims.
 * Granular sub-scopes allow minimal disclosure (e.g., wine shop
 * only needs `vc:verification vc:age`).
 */

import type { VC_DISCLOSURE_KEYS } from "./claims";

type VcClaimKey = (typeof VC_DISCLOSURE_KEYS)[number];

export const VC_SCOPES = [
  "vc:verification",
  "vc:age",
  "vc:document",
  "vc:liveness",
  "vc:nationality",
  "vc:compliance",
] as const;

export type VcScope = (typeof VC_SCOPES)[number];

export function isVcScope(scope: string): scope is VcScope {
  return VC_SCOPES.includes(scope as VcScope);
}

const VC_SCOPE_CLAIMS: Record<VcScope, VcClaimKey[]> = {
  "vc:verification": ["verification_level", "verified"],
  "vc:age": ["age_proof_verified"],
  "vc:document": ["document_verified", "doc_validity_proof_verified"],
  "vc:liveness": ["liveness_verified", "face_match_verified"],
  "vc:nationality": ["nationality_proof_verified"],
  "vc:compliance": [
    "policy_version",
    "issuer_id",
    "verification_time",
    "attestation_expires_at",
  ],
};

export const VC_SCOPE_DESCRIPTIONS: Record<VcScope, string> = {
  "vc:verification": "Identity verification status",
  "vc:age": "Proof you meet the age requirement",
  "vc:document": "Document verification status",
  "vc:liveness": "Liveness and photo match results",
  "vc:nationality": "Nationality verification",
  "vc:compliance": "Verification policy and timestamps",
};

export function extractVcScopes(scopes: string[]): VcScope[] {
  return scopes.filter(isVcScope);
}

/**
 * Get allowed VC claim keys based on requested scopes.
 * `vc:identity` expands to all VC claims.
 */
function getVcClaimKeys(scopes: string[]): Set<VcClaimKey> {
  if (scopes.includes("vc:identity")) {
    return new Set(Object.values(VC_SCOPE_CLAIMS).flat());
  }

  const keys = new Set<VcClaimKey>();
  for (const scope of extractVcScopes(scopes)) {
    for (const key of VC_SCOPE_CLAIMS[scope]) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Filter VC claims to only include those allowed by requested scopes.
 */
export function filterVcClaimsByScopes(
  claims: Record<string, unknown>,
  scopes: string[]
): Record<string, unknown> {
  const allowedKeys = getVcClaimKeys(scopes);
  const filtered: Record<string, unknown> = {};

  for (const key of allowedKeys) {
    if (key in claims && claims[key] !== undefined) {
      filtered[key] = claims[key];
    }
  }

  return filtered;
}
