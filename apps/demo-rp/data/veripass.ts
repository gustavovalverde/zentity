import type { IconSvgElement } from "@hugeicons/react";
import {
	AirplaneTakeOff01Icon,
	Briefcase06Icon,
	PartyIcon,
	BankIcon,
} from "@hugeicons/core-free-icons";

export type VerifierScenario = {
	id: string;
	name: string;
	description: string;
	icon: IconSvgElement;
	requiredClaims: string[];
	optionalClaims: string[];
};

export const VERIFIER_SCENARIOS: VerifierScenario[] = [
	{
		id: "border",
		name: "Border Control",
		description: "International travel identity check",
		icon: AirplaneTakeOff01Icon,
		requiredClaims: ["given_name", "family_name", "nationality"],
		optionalClaims: ["date_of_birth"],
	},
	{
		id: "employer",
		name: "Background Check",
		description: "Employment verification screening",
		icon: Briefcase06Icon,
		requiredClaims: ["given_name", "family_name", "verification_level"],
		optionalClaims: ["email"],
	},
	{
		id: "venue",
		name: "Age-Restricted Venue",
		description: "Minimal disclosure age proof",
		icon: PartyIcon,
		requiredClaims: ["age_over_21"],
		optionalClaims: [],
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
	issuer_id: "Issuer ID",
	verification_time: "Verification Time",
	attestation_expires_at: "Attestation Expiry",
};
