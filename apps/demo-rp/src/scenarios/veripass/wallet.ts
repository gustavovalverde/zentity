import {
  buildRequestedScopes,
  type RouteScenario,
} from "@/scenarios/route-scenario";

const signInScopes = ["openid", "proof:verification"];
const stepUpScopes: string[] = [];

export const veripassWalletScenario: RouteScenario = {
  id: "veripass",
  name: "VeriPass",
  tagline: "Digital Credential Wallet",
  description:
    "eIDAS 2.0 mandates that users control which attributes they share. Receive one credential from Zentity, then reveal only the specific fields each verifier needs. One issuance, many presentations, no over-sharing.",
  oauthProviderId: "zentity-veripass",
  signInScopes,
  stepUpScopes,
  stepUpClaimKeys: [],
  dcr: {
    clientName: "VeriPass Wallet",
    requestedScopes: buildRequestedScopes(signInScopes, stepUpScopes),
  },
  compliance: [
    {
      label: "eIDAS 2.0",
      detail:
        "EU digital identity regulation (2024/1183) mandates selective attribute disclosure and non-traceability for wallet-based credentials. EUDI Wallets required by December 2026.",
      variant: "regulation",
    },
    {
      label: "NIST 800-63-4",
      detail:
        "US federal digital identity guidelines now support a digital evidence pathway for verifiable credentials and mDLs, with privacy-enhancing techniques recognized as fundamental.",
      variant: "regulation",
    },
    {
      label: "SD-JWT VC",
      detail:
        "Selective Disclosure JWT Verifiable Credentials allow the holder to reveal only chosen claims per presentation.",
      variant: "mechanism",
    },
    {
      label: "OID4VCI",
      detail:
        "OpenID for Verifiable Credential Issuance protocol for receiving credentials from a trusted issuer.",
      variant: "mechanism",
    },
  ],
  notShared: [
    "Your raw biometric data",
    "Your document images",
    "Claims you choose not to disclose",
    "Your full identity to any single verifier",
  ],
};
