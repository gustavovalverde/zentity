import {
  buildRequestedScopes,
  type RouteScenario,
} from "@/scenarios/route-scenario";

const signInScopes = ["openid", "email", "proof:verification"];
const stepUpScopes = ["identity.name", "identity.nationality"];

export const aidScenario: RouteScenario = {
  id: "aid",
  name: "Relief Global",
  tagline: "Emergency Aid Distribution",
  description:
    "Humanitarian aid must verify identity to prevent duplicate claims, but centralized databases endanger vulnerable populations. Zentity proves eligibility through minimal disclosure with zero data retention.",
  oauthProviderId: "zentity-aid",
  signInScopes,
  stepUpScopes,
  stepUpClaimKeys: ["name", "nationality"],
  stepUpAction: "Claim Aid",
  dcr: {
    clientName: "Relief Global",
    requestedScopes: buildRequestedScopes(signInScopes, stepUpScopes),
  },
  compliance: [
    {
      label: "GDPR Art. 9",
      detail:
        "Processing identity data of vulnerable populations requires a vital-interests legal basis, not consent, making data minimization structurally mandatory.",
      variant: "regulation",
    },
    {
      label: "Data Minimization",
      detail:
        "Only name and nationality shared. No biometrics retained, no centralized identity database created.",
      variant: "mechanism",
    },
  ],
  notShared: [
    "Your biometric data",
    "Your full address history",
    "Your family connections",
    "Your exact location",
  ],
};
