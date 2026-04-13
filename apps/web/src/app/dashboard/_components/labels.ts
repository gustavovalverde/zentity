/**
 * Centralized labels for verification-related UI components.
 * Single source of truth to avoid duplication across pages.
 */

/** Labels for ZK proof types */
const PROOF_TYPE_LABELS: Record<string, string> = {
  age_verification: "Age ≥ 18",
  doc_validity: "Document Valid",
  nationality_membership: "Nationality Group",
  face_match: "Photo Match",
  identity_binding: "Linked to Account",
};

/** Labels for signed claim types */
const CLAIM_TYPE_LABELS: Record<string, string> = {
  liveness_score: "Selfie Check Score",
  face_match_score: "Photo Match Score",
  ocr_result: "Document OCR",
};

/** Labels for FHE encrypted attributes */
const ENCRYPTED_ATTRIBUTE_LABELS: Record<string, string> = {
  dob_days: "Date of Birth",
  birth_year_offset: "Birth Year",
  country_code: "Country Code",
  compliance_level: "Compliance Level",
  liveness_score: "Selfie Check Score",
};

/** Get label for a proof type, with fallback to raw type */
export function getProofTypeLabel(type: string): string {
  return PROOF_TYPE_LABELS[type] ?? type;
}

/** Get label for a claim type, with fallback to raw type */
export function getClaimTypeLabel(type: string): string {
  return CLAIM_TYPE_LABELS[type] ?? type;
}

/** Get label for an encrypted attribute, with fallback to raw type */
export function getAttributeLabel(type: string): string {
  return ENCRYPTED_ATTRIBUTE_LABELS[type] ?? type;
}
