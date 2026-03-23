export const VERIPASS_ISSUER_CLAIMS = [
  "verification_level",
  "verified",
  "document_verified",
  "liveness_verified",
  "age_verification",
  "face_match_verified",
  "nationality_verified",
  "nationality_group",
  "identity_bound",
  "sybil_resistant",
  "policy_version",
  "verification_time",
  "attestation_expires_at",
  "chip_verified",
  "chip_verification_method",
] as const;

const LEGACY_VERIPASS_CLAIM_ALIASES: Record<string, string> = {
  age_proof_verified: "age_verification",
  doc_validity_proof_verified: "document_verified",
  identity_binding_verified: "identity_bound",
  nationality_proof_verified: "nationality_verified",
};

export function normalizeVeripassClaimKey(key: string): string {
  return LEGACY_VERIPASS_CLAIM_ALIASES[key] ?? key;
}

export function normalizeVeripassClaims(
  claims: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(claims)) {
    const canonicalKey = normalizeVeripassClaimKey(key);
    if (canonicalKey === key || !(canonicalKey in normalized)) {
      normalized[canonicalKey] = value;
    }
  }

  return normalized;
}

export function createVeripassDisclosureKeyMap(
  keys: Iterable<string>
): Map<string, string> {
  const keyMap = new Map<string, string>();

  for (const key of keys) {
    const canonicalKey = normalizeVeripassClaimKey(key);
    if (!keyMap.has(canonicalKey) || canonicalKey === key) {
      keyMap.set(canonicalKey, key);
    }
  }

  return keyMap;
}

export function getMissingVeripassClaims(
  requiredClaims: Iterable<string>,
  availableClaims: Iterable<string>
): string[] {
  const available = new Set(
    Array.from(availableClaims, normalizeVeripassClaimKey)
  );

  return Array.from(requiredClaims).filter(
    (claim) => !available.has(normalizeVeripassClaimKey(claim))
  );
}
