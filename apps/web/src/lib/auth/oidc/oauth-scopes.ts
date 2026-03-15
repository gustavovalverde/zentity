import { IDENTITY_SCOPES } from "./identity-scopes";
import { PROOF_SCOPES } from "./proof-scopes";

/**
 * Canonical set of OAuth scopes supported by the authorization server.
 * Used by oauthProvider config and rp-admin scope validation.
 */
export const OAUTH_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "proof:identity",
  ...PROOF_SCOPES,
  "proof:sybil",
  "compliance:key:read",
  "compliance:key:write",
  ...IDENTITY_SCOPES,
  "identity_verification",
] as const;

export const OAUTH_SCOPE_SET = new Set<string>(OAUTH_SCOPES);
