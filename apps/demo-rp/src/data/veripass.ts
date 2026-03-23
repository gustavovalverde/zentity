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

const VCT = "urn:credential:identity-verification:v1";

function buildDcqlQuery(claimPaths: string[]): DcqlQuery {
  return {
    credentials: [
      {
        id: "identity_credential",
        format: "dc+sd-jwt",
        meta: { vct_values: [VCT] },
        claims: claimPaths.map((path) => ({ path: [path] })),
      },
    ],
  };
}

export const VERIFIER_SCENARIOS: VerifierScenario[] = [
  {
    id: "border",
    name: "Border Control",
    description: "Travel eligibility check with nationality attestation",
    icon: AirplaneTakeOff01Icon,
    requiredClaims: ["verified", "verification_level", "nationality_verified"],
    optionalClaims: ["chip_verified", "document_verified"],
    dcqlQuery: buildDcqlQuery([
      "verified",
      "verification_level",
      "nationality_verified",
    ]),
  },
  {
    id: "employer",
    name: "Background Check",
    description: "Employment-grade identity assurance screening",
    icon: Briefcase06Icon,
    requiredClaims: ["verified", "verification_level", "document_verified"],
    optionalClaims: ["liveness_verified"],
    dcqlQuery: buildDcqlQuery([
      "verified",
      "verification_level",
      "document_verified",
    ]),
  },
  {
    id: "venue",
    name: "Age-Restricted Venue",
    description: "Minimal disclosure age proof",
    icon: PartyIcon,
    requiredClaims: ["age_verification"],
    optionalClaims: [],
    dcqlQuery: buildDcqlQuery(["age_verification"]),
  },
  {
    id: "financial",
    name: "Financial Institution",
    description: "KYC-grade assurance without raw identity disclosure",
    icon: BankIcon,
    requiredClaims: [
      "verified",
      "verification_level",
      "document_verified",
      "liveness_verified",
      "nationality_verified",
    ],
    optionalClaims: ["chip_verified", "policy_version"],
    dcqlQuery: buildDcqlQuery([
      "verified",
      "verification_level",
      "document_verified",
      "liveness_verified",
      "nationality_verified",
    ]),
  },
];

export const CLAIM_LABELS: Record<string, string> = {
  age_proof_verified: "Age Verified",
  age_verification: "Age Verified",
  attestation_expires_at: "Attestation Expiry",
  chip_verification_method: "Chip Verification Method",
  chip_verified: "Chip Verified",
  doc_validity_proof_verified: "Document Verified",
  document_verified: "Document Verified",
  face_match_verified: "Face Match Verified",
  identity_binding_verified: "Identity Bound",
  identity_bound: "Identity Bound",
  liveness_verified: "Liveness Verified",
  nationality_group: "Nationality Group",
  nationality_proof_verified: "Nationality Verified",
  nationality_verified: "Nationality Verified",
  policy_version: "Policy Version",
  sybil_resistant: "Sybil Resistant",
  verification_level: "Verification Level",
  verified: "Verified Status",
  verification_time: "Verification Time",
};
