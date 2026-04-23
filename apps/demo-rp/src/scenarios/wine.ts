import {
  buildRequestedScopes,
  type RouteScenario,
} from "@/scenarios/route-scenario";

const signInScopes = ["openid", "proof:age"];
const stepUpScopes = ["identity.name", "identity.address"];

export const wineScenario: RouteScenario = {
  id: "wine",
  name: "Vino Delivery",
  tagline: "Fine wine at your door",
  description:
    "French law requires age verification with double anonymity: the site learns only a yes or no age result, and the verification provider never learns which site was visited.",
  oauthProviderId: "zentity-wine",
  signInScopes,
  stepUpScopes,
  stepUpClaimKeys: ["name", "address"],
  stepUpAction: "Complete Purchase",
  dcr: {
    clientName: "Vino Delivery",
    requestedScopes: buildRequestedScopes(signInScopes, stepUpScopes),
  },
  compliance: [
    {
      label: "ARCOM",
      detail:
        "French regulatory standard mandates double anonymity: the site cannot identify the user, and the provider cannot identify the site. Mandatory since April 2025.",
      variant: "regulation",
    },
    {
      label: "Loi SREN",
      detail:
        "French law (No. 2024-449) empowers ARCOM to enforce age verification standards on restricted-goods platforms. Penalties up to 4% of worldwide turnover.",
      variant: "regulation",
    },
    {
      label: "Pairwise Pseudonymity",
      detail:
        "Each session uses a unique, unlinkable identifier. No cross-session correlation is possible.",
      variant: "mechanism",
    },
  ],
  notShared: [
    "Your email address",
    "Your exact date of birth",
    "Your document details",
    "Your nationality",
  ],
};
