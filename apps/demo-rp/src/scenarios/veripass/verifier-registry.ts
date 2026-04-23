import { borderVerifierScenario } from "@/scenarios/veripass/border";
import { employerVerifierScenario } from "@/scenarios/veripass/employer";
import { financialVerifierScenario } from "@/scenarios/veripass/financial";
import { venueVerifierScenario } from "@/scenarios/veripass/venue";
import type { VerifierScenario } from "@/scenarios/veripass/verifier-scenario";

export const VERIFIER_SCENARIOS: VerifierScenario[] = [
  borderVerifierScenario,
  employerVerifierScenario,
  venueVerifierScenario,
  financialVerifierScenario,
];

export const CLAIM_LABELS: Record<string, string> = {
  age_verification: "Age Verified",
  attestation_expires_at: "Attestation Expiry",
  chip_verification_method: "Chip Verification Method",
  chip_verified: "Chip Verified",
  document_verified: "Document Verified",
  face_match_verified: "Face Match Verified",
  identity_bound: "Identity Bound",
  liveness_verified: "Liveness Verified",
  nationality_group: "Nationality Group",
  nationality_verified: "Nationality Verified",
  policy_version: "Policy Version",
  sybil_resistant: "Sybil Resistant",
  verification_level: "Verification Level",
  verified: "Verified Status",
  verification_time: "Verification Time",
};
