export interface ComplianceBadge {
  detail: string;
  label: string;
  variant: "regulation" | "mechanism";
}

export interface Scenario {
  acrValues?: string;
  compliance: ComplianceBadge[];
  dcr: { clientName: string; defaultScopes: string; grantTypes?: string[] };
  description: string;
  id: string;
  maxAge?: number;
  name: string;
  notShared: string[];
  providerId: string;
  signInScopes: string[];
  stepUpAction?: string;
  stepUpClaimKeys: string[];
  stepUpScopes: string[];
  tagline: string;
}

function buildDcrScopes(
  signInScopes: string[],
  stepUpScopes: string[]
): string {
  return [...new Set([...signInScopes, ...stepUpScopes])].join(" ");
}

export const SCENARIOS: Record<string, Scenario> = {
  bank: (() => {
    const signInScopes = ["openid", "email", "proof:verification"];
    const stepUpScopes = ["identity.name"];
    return {
      id: "bank",
      maxAge: 300,
      name: "Velocity Bank",
      tagline: "Modern digital banking",
      description:
        "EU anti-money laundering rules require tiered identity verification for account opening. Zentity satisfies CDD obligations through cryptographic proofs and selective name disclosure, without storing documents.",
      providerId: "zentity-bank",
      signInScopes,
      stepUpScopes,
      stepUpClaimKeys: ["name"],
      stepUpAction: "Open Account",
      dcr: {
        clientName: "Velocity Bank",
        defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
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
  })(),
  exchange: (() => {
    const signInScopes = ["openid", "email", "proof:verification"];
    const stepUpScopes = ["identity.nationality"];
    return {
      acrValues: "urn:zentity:assurance:tier-2",
      id: "exchange",
      name: "Nova Exchange",
      tagline: "Trade crypto globally",
      description:
        "MiCA requires crypto exchanges to verify customer identity and nationality for sanctions compliance. Zentity proves nationality through zero-knowledge proofs, with no document upload or retention.",
      providerId: "zentity-exchange",
      signInScopes,
      stepUpScopes,
      stepUpClaimKeys: ["nationality"],
      stepUpAction: "Start Trading",
      dcr: {
        clientName: "Nova Exchange",
        defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
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
  })(),
  wine: (() => {
    const signInScopes = ["openid", "proof:age"];
    const stepUpScopes = ["identity.name", "identity.address"];
    return {
      id: "wine",
      name: "Vino Delivery",
      tagline: "Fine wine at your door",
      description:
        "French law requires age verification with double anonymity: the site learns only a yes/no age result, and the verification provider never learns which site was visited.",
      providerId: "zentity-wine",
      signInScopes,
      stepUpScopes,
      stepUpClaimKeys: ["name", "address"],
      stepUpAction: "Complete Purchase",
      dcr: {
        clientName: "Vino Delivery",
        defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
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
  })(),
  aid: (() => {
    const signInScopes = ["openid", "email", "proof:verification"];
    const stepUpScopes = ["identity.name", "identity.nationality"];
    return {
      id: "aid",
      name: "Relief Global",
      tagline: "Emergency Aid Distribution",
      description:
        "Humanitarian aid requires identity verification to prevent duplicate claims, but centralized databases endanger vulnerable populations. Zentity proves eligibility with minimal disclosure and zero data retention.",
      providerId: "zentity-aid",
      signInScopes,
      stepUpScopes,
      stepUpClaimKeys: ["name", "nationality"],
      stepUpAction: "Claim Aid",
      dcr: {
        clientName: "Relief Global",
        defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
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
  })(),
  veripass: (() => {
    const signInScopes = ["openid", "proof:verification"];
    const stepUpScopes: string[] = [];
    return {
      id: "veripass",
      name: "VeriPass",
      tagline: "Digital Credential Wallet",
      description:
        "eIDAS 2.0 mandates that users control exactly which attributes they share. Receive one verifiable credential, then selectively disclose different claims to different verifiers.",
      providerId: "zentity-veripass",
      signInScopes,
      stepUpScopes,
      stepUpClaimKeys: [],
      dcr: {
        clientName: "VeriPass Wallet",
        defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
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
  })(),
  aether: (() => {
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
    return {
      acrValues: "urn:zentity:assurance:tier-2",
      id: "aether",
      name: "Aether AI",
      tagline: "Personal Shopping Agent",
      description:
        "AI agents act on your behalf but need explicit authorization for sensitive actions. CIBA lets the agent request approval via a backchannel — you approve on your own device, and the agent completes the purchase.",
      providerId: "zentity-aether",
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
        defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
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
            "OpenID Client Initiated Backchannel Authentication enables decoupled authorization — the agent requests access, the user approves from a separate device.",
          variant: "mechanism" as const,
        },
        {
          label: "EU AI Act",
          detail:
            "High-risk AI systems must obtain explicit human authorization before executing financial transactions. CIBA provides cryptographic proof of user consent.",
          variant: "regulation" as const,
        },
        {
          label: "Decoupled Auth",
          detail:
            "The agent never handles user credentials. Authorization tokens are scoped and short-lived, issued only after user approval.",
          variant: "mechanism" as const,
        },
      ],
      notShared: [
        "Your credentials or passwords",
        "Your payment details",
        "Your browsing session",
        "Any data beyond the approved scopes",
      ],
    };
  })(),
  x402: (() => {
    const signInScopes = ["openid", "email", "poh"];
    const stepUpScopes: string[] = [];
    return {
      id: "x402",
      name: "x402 Protocol",
      tagline: "Machine Commerce",
      description:
        "HTTP 402 enables machine-to-machine payments with built-in compliance. Resource servers declare requirements, agents prove humanity through Zentity's compliance oracle, and on-chain FHE-encrypted checks gate settlement — all without revealing identity data.",
      providerId: "zentity-x402",
      signInScopes,
      stepUpScopes,
      stepUpClaimKeys: [],
      dcr: {
        clientName: "x402 Demo",
        defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
      },
      compliance: [
        {
          label: "x402",
          detail:
            "HTTP 402 Payment Required protocol for machine commerce. Resource servers advertise compliance requirements in structured responses; agents negotiate access automatically.",
          variant: "mechanism" as const,
        },
        {
          label: "FHE Oracle",
          detail:
            "On-chain compliance checks using fully homomorphic encryption. The smart contract evaluates encrypted identity attributes without decryption.",
          variant: "mechanism" as const,
        },
        {
          label: "Proof-of-Human",
          detail:
            "Compact JWTs asserting verification tier and sybil resistance. No personal data disclosed — just a cryptographic yes/no.",
          variant: "mechanism" as const,
        },
      ],
      notShared: [
        "Your identity documents",
        "Your exact date of birth",
        "Your face or biometric data",
        "Your compliance level to unrelated services",
      ],
    };
  })(),
} as const;

export function getScenario(id: string): Scenario {
  const scenario = SCENARIOS[id];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  return scenario;
}
