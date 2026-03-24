import { RUNTIME_BOOTSTRAP_SCOPES } from "./bootstrap-scopes.js";

// Keep these values aligned with apps/web/src/lib/auth/oidc/agent-scopes.ts.
export const INSTALLED_AGENT_LOGIN_SCOPES = [
  "openid",
  "email",
  "offline_access",
] as const;

export const INSTALLED_AGENT_LOGIN_SCOPE_STRING =
  INSTALLED_AGENT_LOGIN_SCOPES.join(" ");

export const INSTALLED_AGENT_REGISTRATION_SCOPES = [
  ...INSTALLED_AGENT_LOGIN_SCOPES,
  ...RUNTIME_BOOTSTRAP_SCOPES,
];

export const INSTALLED_AGENT_REGISTRATION_SCOPE_STRING =
  INSTALLED_AGENT_REGISTRATION_SCOPES.join(" ");
