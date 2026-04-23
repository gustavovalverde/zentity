import {
  buildRequestedScopes,
  type RouteScenario,
} from "@/scenarios/route-scenario";

const signInScopes = [
  "openid",
  "email",
  "agent:host.register",
  "agent:session.register",
];
const stepUpScopes = [
  "proof:age",
  "proof:nationality",
  "identity.name",
  "identity.address",
];

export const aetherScenario: RouteScenario = {
  acrValues: "urn:zentity:assurance:tier-2",
  id: "aether",
  name: "Aether AI",
  tagline: "Personal Shopping Agent",
  description:
    "AI agents act on your behalf but need explicit authorization for sensitive actions. The agent requests approval through a secure backchannel; you confirm on your own device, and it completes the purchase. Your credentials never touch the agent.",
  oauthProviderId: "zentity-aether",
  signInScopes,
  stepUpScopes,
  stepUpClaimKeys: [
    "age_verification",
    "nationality_verified",
    "name",
    "address",
  ],
  dcr: {
    clientName: "Aether AI",
    requestedScopes: buildRequestedScopes(signInScopes, stepUpScopes),
    grantTypes: [
      "authorization_code",
      "urn:openid:params:grant-type:ciba",
      "urn:ietf:params:oauth:grant-type:token-exchange",
    ],
  },
  compliance: [
    {
      label: "CIBA",
      detail:
        "OpenID Client Initiated Backchannel Authentication enables decoupled authorization: the agent requests access, and the user approves from a separate device.",
      variant: "mechanism",
    },
    {
      label: "EU AI Act",
      detail:
        "High-risk AI systems must obtain explicit human authorization before executing financial transactions. CIBA provides cryptographic proof of user consent.",
      variant: "regulation",
    },
    {
      label: "Decoupled Auth",
      detail:
        "The agent never handles user credentials. Authorization tokens are scoped and short-lived, issued only after user approval.",
      variant: "mechanism",
    },
  ],
  notShared: [
    "Your credentials or passwords",
    "Your payment details",
    "Your browsing session",
    "Any data beyond the approved scopes",
  ],
};
