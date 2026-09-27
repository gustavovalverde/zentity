export type AccountTier = 0 | 1 | 2 | 3;

export const TIER_NAMES = {
	0: "Anonymous",
	1: "Account",
	2: "Verified",
	3: "Chip Verified",
} as const;

export type TierName = (typeof TIER_NAMES)[AccountTier];

export type AuthStrength = "basic" | "strong";

export type LoginMethod =
	| "passkey"
	| "opaque"
	| "magic-link"
	| "oauth"
	| "eip712"
	| "credential";

export type AuthenticationSourceKind =
	| "better_auth"
	| "authorize_challenge_opaque"
	| "authorize_challenge_eip712"
	| "authorize_challenge_redirect"
	| "ciba_approval"
	| "token_exchange";

export interface VerificationDetails {
	chipVerified: boolean;
	documentVerified: boolean;
	faceMatchVerified: boolean;
	fheComplete: boolean;
	hasIncompleteProofs: boolean;
	hasSecuredKeys: boolean;
	isAuthenticated: boolean;
	livenessVerified: boolean;
	missingProfileSecret: boolean;
	needsDocumentReprocessing: boolean;
	onChainAttested: boolean;
	zkProofsComplete: boolean;
}

export interface AccountAssurance {
	details: VerificationDetails;
	tier: AccountTier;
	tierName: TierName;
}

export interface AuthenticationState {
	amr: string[];
	authenticatedAt: number;
	authStrength: AuthStrength;
	id: string;
	loginMethod: LoginMethod;
	sourceKind: AuthenticationSourceKind;
}

export interface AccountCapabilities {
	hasOpaqueAccount: boolean;
	hasPasskeys: boolean;
	hasWalletAuth: boolean;
}

/** Response of the `assurance.profile` procedure. */
export interface SecurityPosture {
	assurance: AccountAssurance;
	auth: AuthenticationState | null;
	capabilities: AccountCapabilities;
}
