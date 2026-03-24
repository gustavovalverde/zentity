// Keep these values aligned with apps/web/src/lib/auth/oidc/agent-scopes.ts.
export const INSTALLED_AGENT_LOGIN_SCOPES = [
  "openid",
  "email",
  "offline_access",
] as const;

export const INSTALLED_AGENT_LOGIN_SCOPE_STRING =
  INSTALLED_AGENT_LOGIN_SCOPES.join(" ");
