export const AAP_CLAIMS_VERSION = 2 as const;
export const AGENT_DID_METHODS_SUPPORTED = ["did:key"] as const;
/** No token carries a host's DID; `act.sub` is the only actor identifier. */
export const ACT_DID_EMISSION_POLICY = "never" as const;

export type SdkErrorCode =
	| "compliance_insufficient"
	| "invalid_did_key_format"
	| "token_refresh_failed"
	| "use_dpop_nonce";

export const HOST_ATTESTATION_TIERS = [
	"attested",
	"self-declared",
	"unverified",
] as const;
export type HostAttestationTier = (typeof HOST_ATTESTATION_TIERS)[number];

/**
 * How a user approved a CIBA request: an agent capability grant, a click in
 * an active session, or a passkey assertion with user verification.
 */
export type OversightMethod =
	| "capability_grant"
	| "session"
	| "user_verification";

export interface CapabilityClaim {
	action: string;
	constraints?: unknown;
}

/**
 * The RFC 8693 actor of an agent-backed token: a pairwise identifier for the
 * agent session in the token's own sector, so each audience sees its own
 * value. Session, host, and key identifiers stay with the authorization
 * server.
 */
export interface AccessTokenActClaim {
	sub: string;
	/** RFC 8693 actor profile: the agent is a service, not a user. */
	sub_profile?: "service";
}

/** How the user approved a CIBA request, as Zentity recorded it. */
export interface AccessTokenOversightClaim {
	/** When the decision was recorded, in seconds since the epoch. */
	approved_at: number;
	method: OversightMethod;
}

/** The depth of a delegated token; no delegation chain forms in this version. */
export interface AccessTokenDelegationClaim {
	depth: number;
	max_depth: number;
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

/**
 * What an agent-backed CIBA approval authorizes. The CIBA token response and
 * agent introspection carry it; the access token does not, because a client
 * must not read its access token (RFC 9068 §6).
 */
export interface AgentAuthorization {
	aap_claims_version: typeof AAP_CLAIMS_VERSION;
	capabilities: CapabilityClaim[];
	delegation: AccessTokenDelegationClaim;
	oversight: AccessTokenOversightClaim;
}

/** The claims a resource server reads from a Zentity JWT access token. */
export interface AccessTokenClaims extends StandardAccessTokenClaims {
	act?: AccessTokenActClaim;
	authorization_details?: unknown[];
}
