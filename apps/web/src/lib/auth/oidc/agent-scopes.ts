export const AGENT_HOST_REGISTER_SCOPE = "agent:host.register";
export const AGENT_SESSION_REGISTER_SCOPE = "agent:session.register";
export const AGENT_SESSION_REVOKE_SCOPE = "agent:session.revoke";
export const AGENT_INTROSPECT_SCOPE = "agent:introspect";

export const AGENT_BOOTSTRAP_SCOPES = [
  AGENT_HOST_REGISTER_SCOPE,
  AGENT_SESSION_REGISTER_SCOPE,
  AGENT_SESSION_REVOKE_SCOPE,
] as const;

export const AGENT_BOOTSTRAP_SCOPE_SET = new Set<string>(
  AGENT_BOOTSTRAP_SCOPES
);

export const AGENT_BOOTSTRAP_TOKEN_USE = "agent_bootstrap";
