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

export function getMissingVeripassClaims(
  requiredClaims: Iterable<string>,
  availableClaims: Iterable<string>
): string[] {
  const available = new Set(availableClaims);

  return Array.from(requiredClaims).filter((claim) => !available.has(claim));
}
