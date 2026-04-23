import {
  AirplaneTakeOff01Icon,
  BankIcon,
  Briefcase06Icon,
  PartyIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

export interface DcqlCredentialQuery {
  claims: Array<{ path: string[] }>;
  format: string;
  id: string;
  meta: { vct_values: string[] };
  trusted_authorities?: Array<{ type: string; value: string }>;
}

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
}

export interface VerifierScenario {
  dcqlQuery: DcqlQuery;
  description: string;
  icon: IconSvgElement;
  id: string;
  name: string;
  optionalClaims: string[];
  requiredClaims: string[];
}

interface CreateVerifierScenarioOptions {
  description: string;
  icon: IconSvgElement;
  id: string;
  name: string;
  optionalClaims?: string[];
  requiredClaims: string[];
}

const IDENTITY_VERIFICATION_VCT = "urn:credential:identity-verification:v1";

function buildDcqlQuery(claimKeys: string[]): DcqlQuery {
  return {
    credentials: [
      {
        id: "identity_credential",
        format: "dc+sd-jwt",
        meta: { vct_values: [IDENTITY_VERIFICATION_VCT] },
        claims: claimKeys.map((claimKey) => ({ path: [claimKey] })),
      },
    ],
  };
}

export function createVerifierScenario(
  options: CreateVerifierScenarioOptions
): VerifierScenario {
  return {
    ...options,
    dcqlQuery: buildDcqlQuery(options.requiredClaims),
    optionalClaims: options.optionalClaims ?? [],
  };
}

export const VERIFIER_SCENARIO_ICONS = {
  border: AirplaneTakeOff01Icon,
  employer: Briefcase06Icon,
  venue: PartyIcon,
  financial: BankIcon,
} as const;
