import {
  createVerifierScenario,
  VERIFIER_SCENARIO_ICONS,
  type VerifierScenario,
} from "@/scenarios/veripass/verifier-scenario";

export const venueVerifierScenario: VerifierScenario = createVerifierScenario({
  id: "venue",
  name: "Age-Restricted Venue",
  description: "Minimal disclosure age proof",
  icon: VERIFIER_SCENARIO_ICONS.venue,
  requiredClaims: ["age_verification"],
});
