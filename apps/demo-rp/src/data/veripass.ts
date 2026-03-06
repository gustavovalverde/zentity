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
    description: "International travel identity check",
    icon: AirplaneTakeOff01Icon,
    requiredClaims: ["given_name", "family_name", "nationality"],
    optionalClaims: ["date_of_birth"],
    dcqlQuery: buildDcqlQuery([
      "given_name",
      "family_name",
      "nationality",
      "verified",
    ]),
  },
  {
    id: "employer",
    name: "Background Check",
    description: "Employment verification screening",
    icon: Briefcase06Icon,
    requiredClaims: ["given_name", "family_name", "verification_level"],
    optionalClaims: ["email"],
    dcqlQuery: buildDcqlQuery([
      "given_name",
      "family_name",
      "verification_level",
      "verified",
    ]),
  },
  {
    id: "venue",
    name: "Age-Restricted Venue",
    description: "Minimal disclosure age proof",
    icon: PartyIcon,
    requiredClaims: ["age_over_21"],
    optionalClaims: [],
    dcqlQuery: buildDcqlQuery(["age_over_18"]),
  },
  {
    id: "financial",
    name: "Financial Institution",
    description: "Full KYC identity verification",
    icon: BankIcon,
    requiredClaims: [
      "given_name",
      "family_name",
      "nationality",
      "verification_level",
      "email",
    ],
    optionalClaims: [],
    dcqlQuery: buildDcqlQuery([
      "given_name",
      "family_name",
      "nationality",
      "verification_level",
      "verified",
    ]),
  },
];

export const CLAIM_LABELS: Record<string, string> = {
  given_name: "First Name",
  family_name: "Last Name",
  email: "Email Address",
  nationality: "Nationality",
  date_of_birth: "Date of Birth",
  age_over_21: "Age Over 21",
  verification_level: "Verification Level",
  verified: "Verified Status",
  document_verified: "Document Verified",
  liveness_verified: "Liveness Verified",
  age_proof_verified: "Age Proof Verified",
  doc_validity_proof_verified: "Document Validity Verified",
  nationality_proof_verified: "Nationality Verified",
  face_match_verified: "Face Match Verified",
  policy_version: "Policy Version",
  verification_time: "Verification Time",
  attestation_expires_at: "Attestation Expiry",
};
