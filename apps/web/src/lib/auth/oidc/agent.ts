import { z } from "zod";

// ── Agent OAuth Scopes ───────────────────────────────────
// Keep aligned with apps/mcp/src/auth/bootstrap-scopes.ts and
// apps/mcp/src/auth/installed-agent-scopes.ts.

export const AGENT_HOST_REGISTER_SCOPE = "agent:host.register";
export const AGENT_SESSION_REGISTER_SCOPE = "agent:session.register";
export const AGENT_SESSION_REVOKE_SCOPE = "agent:session.revoke";

export const AGENT_BOOTSTRAP_SCOPES = [
  AGENT_HOST_REGISTER_SCOPE,
  AGENT_SESSION_REGISTER_SCOPE,
  AGENT_SESSION_REVOKE_SCOPE,
] as const;

export const AGENT_BOOTSTRAP_SCOPE_SET = new Set<string>(
  AGENT_BOOTSTRAP_SCOPES
);

export const AGENT_BOOTSTRAP_TOKEN_USE = "agent_bootstrap";

// ── Agent Configuration (well-known document) ────────────
// Keep aligned with apps/mcp/src/auth/agent-configuration.ts.

const agentBootstrapTokenExchangeSchema = z.object({
  audience: z.string().url(),
  grant_type: z.string().min(1),
  requested_token_type: z.string().min(1),
  scopes_supported: z.array(z.string().min(1)),
  token_use: z.string().min(1),
});

export const agentConfigurationSchema = z.object({
  approval_methods: z.array(z.string().min(1)),
  approval_page_url_template: z.string().url(),
  bootstrap_token_exchange: agentBootstrapTokenExchangeSchema,
  capabilities_endpoint: z.string().url(),
  host_registration_endpoint: z.string().url(),
  introspection_endpoint: z.string().url(),
  issuer: z.string().url(),
  jwks_uri: z.string().url(),
  registration_endpoint: z.string().url(),
  revocation_endpoint: z.string().url(),
  supported_algorithms: z.array(z.string().min(1)),
  supported_features: z.object({
    bootstrap_token_exchange: z.boolean(),
    task_attestation: z.boolean(),
    pairwise_agents: z.boolean(),
    risk_graduated_approval: z.boolean(),
    capability_constraints: z.boolean(),
    delegation_chains: z.boolean(),
  }),
});

export type AgentConfiguration = z.infer<typeof agentConfigurationSchema>;

// ── Agent Registration (host + session request schemas) ──
// Keep aligned with apps/mcp/src/auth/agent-registration-contract.ts.

export const registerHostRequestSchema = z.object({
  publicKey: z.string().min(1),
  name: z.string().min(1).max(255),
});

const agentDisplaySchema = z.object({
  model: z.string().max(128).optional(),
  name: z.string().min(1).max(128),
  runtime: z.string().max(128).optional(),
  version: z.string().max(64).optional(),
});

export const registerSessionRequestSchema = z.object({
  hostJwt: z.string().min(1),
  agentPublicKey: z.string().min(1),
  requestedCapabilities: z.array(z.string()).optional(),
  display: agentDisplaySchema,
});
