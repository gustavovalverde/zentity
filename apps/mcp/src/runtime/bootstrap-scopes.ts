// Keep these values aligned with apps/web/src/lib/agents/session.ts.
export const RUNTIME_BOOTSTRAP_SCOPES = [
  "agent:host.register",
  "agent:session.register",
  "agent:session.revoke",
] as const;

export const RUNTIME_BOOTSTRAP_SCOPE_STRING =
  RUNTIME_BOOTSTRAP_SCOPES.join(" ");
