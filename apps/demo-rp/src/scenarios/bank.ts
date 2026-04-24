import {
  buildRequestedScopes,
  type RouteScenario,
} from "@/scenarios/route-scenario";

const signInScopes = ["openid", "email", "proof:verification"];
const stepUpScopes = ["identity.name"];

export const bankScenario: RouteScenario = {
  id: "bank",
  maxAge: 300,
  name: "Velocity Bank",
  tagline: "Modern digital banking",
  description:
    "EU anti-money laundering rules require tiered identity verification for account opening. Zentity satisfies CDD obligations through cryptographic proofs and selective name disclosure, without storing documents.",
  oauthProviderId: "zentity-bank",
  signInScopes,
  stepUpScopes,
  stepUpClaimKeys: ["name"],
  stepUpAction: "Open Account",
  dcr: {
    clientName: "Velocity Bank",
    requestedScopes: buildRequestedScopes(signInScopes, stepUpScopes),
  },
  compliance: [
    {
      label: "AMLD6",
      detail:
        "EU anti-money laundering directive requires tiered identity verification (Customer Due Diligence) for account opening and ongoing monitoring.",
      variant: "regulation",
    },
    {
      label: "PSD2 SCA",
      detail:
        "Strong Customer Authentication requires two independent factors. Passkey authentication satisfies possession and inherence.",
      variant: "regulation",
    },
    {
      label: "Step-Up Auth",
      detail:
        "Basic verification at sign-in, enhanced identity disclosure for high-value actions.",
      variant: "mechanism",
    },
  ],
  notShared: [
    "Your passport image",
    "Your exact date of birth",
    "Your passport number",
    "Your document expiry date",
  ],
};
