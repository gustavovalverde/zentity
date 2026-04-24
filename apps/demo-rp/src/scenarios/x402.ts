import {
  buildRequestedScopes,
  type RouteScenario,
} from "@/scenarios/route-scenario";

const signInScopes = ["openid", "email", "poh"];
const stepUpScopes: string[] = [];

export const x402Scenario: RouteScenario = {
  id: "x402",
  name: "x402 Protocol",
  tagline: "Machine Commerce",
  description:
    "Machines need to pay machines, but compliance rules still apply. An agent proves it represents a verified human, and an on-chain encrypted check confirms eligibility before settlement. No identity data is revealed to any party.",
  oauthProviderId: "zentity-x402",
  signInScopes,
  stepUpScopes,
  stepUpClaimKeys: [],
  dcr: {
    clientName: "x402 Demo",
    requestedScopes: buildRequestedScopes(signInScopes, stepUpScopes),
  },
  compliance: [
    {
      label: "x402",
      detail:
        "HTTP 402 Payment Required protocol for machine commerce. Services advertise compliance requirements in structured responses; agents negotiate access automatically.",
      variant: "mechanism",
    },
    {
      label: "FHE Oracle",
      detail:
        "On-chain compliance checks using fully homomorphic encryption. The smart contract evaluates encrypted identity attributes without decryption.",
      variant: "mechanism",
    },
    {
      label: "Proof-of-Human",
      detail:
        "Compact JWTs asserting verification tier and sybil resistance. No personal data is disclosed, only a cryptographic yes or no.",
      variant: "mechanism",
    },
  ],
  notShared: [
    "Your identity documents",
    "Your exact date of birth",
    "Your face or biometric data",
    "Your compliance level to unrelated services",
  ],
};
