import { RUNTIME_BOOTSTRAP_SCOPES } from "./bootstrap-scopes.js";

// Keep these values aligned with the MCP-installed-agent scopes accepted by
// apps/web/src/lib/auth/auth.ts and the bootstrap scope constants in
// apps/web/src/lib/auth/oidc/agent-scopes.ts.

/**
 * Scopes requested at login time. The resulting session token carries these.
 * proof:identity is included so my_proofs can read proof claims from userinfo
 * without a separate CIBA approval (proof claims are non-PII).
 */
export const INSTALLED_AGENT_LOGIN_SCOPES = [
  "openid",
  "email",
  "offline_access",
  "proof:identity",
] as const;

/**
 * Scopes that require per-request CIBA approval (identity.* = vault-gated PII,
 * proof:age/nationality = purchase-specific). Not requested at login time.
 */
const INSTALLED_AGENT_CIBA_SCOPES = [
  "identity.name",
  "identity.address",
  "identity.dob",
  "proof:age",
  "proof:nationality",
] as const;

export const INSTALLED_AGENT_LOGIN_SCOPE_STRING =
  INSTALLED_AGENT_LOGIN_SCOPES.join(" ");

export const INSTALLED_AGENT_REGISTRATION_SCOPES = [
  ...INSTALLED_AGENT_LOGIN_SCOPES,
  ...INSTALLED_AGENT_CIBA_SCOPES,
  ...RUNTIME_BOOTSTRAP_SCOPES,
];

export const INSTALLED_AGENT_REGISTRATION_SCOPE_STRING =
  INSTALLED_AGENT_REGISTRATION_SCOPES.join(" ");
