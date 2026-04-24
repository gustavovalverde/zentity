import {
  createVerifierScenario,
  VERIFIER_SCENARIO_ICONS,
  type VerifierScenario,
} from "@/scenarios/veripass/verifier-scenario";

export const financialVerifierScenario: VerifierScenario =
  createVerifierScenario({
    id: "financial",
    name: "Financial Institution",
    description: "KYC-grade assurance without raw identity disclosure",
    icon: VERIFIER_SCENARIO_ICONS.financial,
    requiredClaims: [
      "verified",
      "verification_level",
      "document_verified",
      "liveness_verified",
      "nationality_verified",
    ],
    optionalClaims: ["chip_verified", "policy_version"],
  });
