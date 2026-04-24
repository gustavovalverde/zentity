import {
  createVerifierScenario,
  VERIFIER_SCENARIO_ICONS,
  type VerifierScenario,
} from "@/scenarios/veripass/verifier-scenario";

export const employerVerifierScenario: VerifierScenario =
  createVerifierScenario({
    id: "employer",
    name: "Background Check",
    description: "Employment-grade identity assurance screening",
    icon: VERIFIER_SCENARIO_ICONS.employer,
    requiredClaims: ["verified", "verification_level", "document_verified"],
    optionalClaims: ["liveness_verified"],
  });
