/**
 * Centralized labels for verification-related UI components.
 * Single source of truth to avoid duplication across pages.
 */

/** Labels for ZK proof types */
const PROOF_TYPE_LABELS: Record<string, string> = {
  age_verification: "Age ≥ 18",
  doc_validity: "Document Valid",
  nationality_membership: "Nationality Group",
  face_match: "Face Match",
};

/** Labels for signed claim types */
const CLAIM_TYPE_LABELS: Record<string, string> = {
  liveness_score: "Liveness Score",
  face_match_score: "Face Match Score",
};

/** Labels for FHE encrypted attributes */
const ENCRYPTED_ATTRIBUTE_LABELS: Record<string, string> = {
  dob_days: "Date of Birth",
  country_code: "Country Code",
  compliance_level: "Compliance Level",
  liveness_score: "Liveness Score",
};

/** Fallback country names when backend doesn't provide display name */
const COUNTRY_NAMES: Record<string, string> = {
  DOM: "Dominican Republic",
  USA: "United States",
  ESP: "Spain",
  MEX: "Mexico",
  FRA: "France",
  DEU: "Germany",
  GBR: "United Kingdom",
  CAN: "Canada",
  BRA: "Brazil",
  ARG: "Argentina",
  COL: "Colombia",
  PER: "Peru",
  CHL: "Chile",
  ITA: "Italy",
  PRT: "Portugal",
};

/** Get display name for a country code, with fallback */
export function getCountryDisplayName(code: string, name?: string): string {
  return name ?? COUNTRY_NAMES[code] ?? code;
}

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
