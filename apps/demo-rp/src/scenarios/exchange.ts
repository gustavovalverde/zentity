import {
  buildRequestedScopes,
  type RouteScenario,
} from "@/scenarios/route-scenario";

const signInScopes = ["openid", "email", "proof:verification"];
const stepUpScopes = ["identity.nationality"];

export const exchangeScenario: RouteScenario = {
  acrValues: "urn:zentity:assurance:tier-2",
  id: "exchange",
  name: "Nova Exchange",
  tagline: "Trade crypto globally",
  description:
    "MiCA requires crypto exchanges to verify customer identity and nationality for sanctions compliance. Zentity proves nationality through zero-knowledge proofs, with no document upload or retention.",
  oauthProviderId: "zentity-exchange",
  signInScopes,
  stepUpScopes,
  stepUpClaimKeys: ["nationality"],
  stepUpAction: "Start Trading",
  dcr: {
    clientName: "Nova Exchange",
    requestedScopes: buildRequestedScopes(signInScopes, stepUpScopes),
  },
  compliance: [
    {
      label: "MiCA",
      detail:
        "EU crypto-asset regulation (2023/1114) requires identity verification for all trading accounts, with full CDD above EUR 1,000. Grandfathering ends July 2026.",
      variant: "regulation",
    },
    {
      label: "Travel Rule",
      detail:
        "Transfer of Funds Regulation (EU 2023/1113) requires originator and beneficiary identification for crypto transfers.",
      variant: "regulation",
    },
    {
      label: "DAC8",
      detail:
        "EU crypto tax reporting directive (2023/2226) requires CASPs to verify customer identity and report transactions to tax authorities. Full effect since January 2026.",
      variant: "regulation",
    },
    {
      label: "GENIUS Act",
      detail:
        "US stablecoin law (signed July 2025) mandates Treasury to evaluate digital identity verification mechanisms for AML compliance, with privacy risk as an explicit criterion.",
      variant: "regulation",
    },
    {
      label: "Zero-Knowledge Proofs",
      detail:
        "Nationality proven cryptographically without revealing the underlying document.",
      variant: "mechanism",
    },
  ],
  notShared: [
    "Your passport image",
    "Your full address",
    "Your document number",
    "Your face photo",
  ],
};
