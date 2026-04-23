import {
  createVerifierScenario,
  VERIFIER_SCENARIO_ICONS,
  type VerifierScenario,
} from "@/scenarios/veripass/verifier-scenario";

export const borderVerifierScenario: VerifierScenario = createVerifierScenario({
  id: "border",
  name: "Border Control",
  description: "Travel eligibility check with nationality attestation",
  icon: VERIFIER_SCENARIO_ICONS.border,
  requiredClaims: ["verified", "verification_level", "nationality_verified"],
  optionalClaims: ["chip_verified", "document_verified"],
});
