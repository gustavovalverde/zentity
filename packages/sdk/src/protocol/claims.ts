export const AAP_CLAIMS_VERSION = 1 as const;
export const AGENT_DID_METHODS_SUPPORTED = ["did:key"] as const;
export const ACT_DID_EMISSION_POLICY = "attested_hosts_only" as const;

export type SdkErrorCode =
  | "compliance_insufficient"
  | "invalid_did_key_format"
  | "token_refresh_failed"
  | "use_dpop_nonce";

export type HostAttestationTier =
  | "attested"
  | "self-declared"
  | "unverified";

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

export interface StandardAccessTokenClaims {
  aud: string | string[];
  client_id: string;
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
