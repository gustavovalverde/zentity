export const AAP_CLAIMS_VERSION = 1 as const;
export const AGENT_DID_METHODS_SUPPORTED = ["did:key"] as const;
export const ACT_DID_EMISSION_POLICY = "attested_hosts_only" as const;

export type SdkErrorCode =
	| "compliance_insufficient"
	| "invalid_did_key_format"
	| "token_refresh_failed"
	| "use_dpop_nonce";

export type HostAttestationTier = "attested" | "self-declared" | "unverified";

export type OversightMethod =
	| "biometric"
	| "capability_grant"
	| "email"
	| "session";

export interface CapabilityClaim {
	action: string;
	constraints?: unknown;
}

export interface AccessTokenActClaim {
	sub: string;
	did?: string;
	host_attestation: HostAttestationTier;
	session_id: string;
	host_id?: string;
	operator?: string;
	type?: string;
}

export interface AccessTokenTaskClaim {
	constraints?: unknown;
	created_at: number;
	description: string;
	expires_at: number;
	hash: string;
}

export interface AccessTokenOversightClaim {
	approval_id: string;
	approved_at: number;
	method: OversightMethod;
}

export interface AccessTokenAuditClaim {
	ciba_request_id?: string;
	context_id: string;
	release_id: string;
	request_id?: string;
}

export interface AccessTokenDelegationClaim {
	depth: number;
	max_depth: number;
	parent_jti: string | null;
}

export interface ConfirmationClaim {
	/** RFC 7638 SHA-256 JWK thumbprint of the bound DPoP key. */
	jkt: string;
}

export interface StandardAccessTokenClaims {
	aud: string | string[];
	client_id: string;
	/**
	 * RFC 7800 / RFC 9449 §6 confirmation. Present on DPoP-bound tokens (the
	 * payment_authorization spend token among them): `cnf.jkt` is the thumbprint
	 * of the presenter's DPoP key, which the wallet matches against the live
	 * proof on every spend. Orthogonal to `aud`: `aud` names which wallet the
	 * token is for; `cnf` proves who may present it.
	 */
	cnf?: ConfirmationClaim;
	exp: number;
	iat: number;
	iss: string;
	jti: string;
	scope?: string;
	sub: string;
}

export interface AapAccessTokenClaims {
	act: AccessTokenActClaim;
	aap_claims_version: typeof AAP_CLAIMS_VERSION;
	audit: AccessTokenAuditClaim;
	capabilities: CapabilityClaim[];
	delegation: AccessTokenDelegationClaim;
	oversight: AccessTokenOversightClaim;
	task: AccessTokenTaskClaim;
}

export interface AccessTokenClaims
	extends StandardAccessTokenClaims,
		AapAccessTokenClaims {}
