import { z } from "zod";
import {
  AAP_CLAIMS_VERSION,
  ACT_DID_EMISSION_POLICY,
  AGENT_DID_METHODS_SUPPORTED,
} from "./protocol/claims";

// Wire contract between the Zentity server and agent runtimes: the OAuth
// scopes that authorize agent bootstrap and the agent-configuration document
// that advertises the registration endpoints.

export const AGENT_HOST_REGISTER_SCOPE = "agent:host.register";
export const AGENT_SESSION_REGISTER_SCOPE = "agent:session.register";
export const AGENT_SESSION_REVOKE_SCOPE = "agent:session.revoke";

/**
 * The `error_description` of the `invalid_request` with which bc-authorize
 * refuses an Agent-Assertion from a session that is unknown, revoked, idle
 * past its TTL, or past its lifetime. The runtime registers a new session and
 * signs again; any other refused assertion does not match its request.
 */
export const AGENT_SESSION_INACTIVE_DESCRIPTION = "Agent session is not active";

export const AGENT_BOOTSTRAP_SCOPES = [
  AGENT_HOST_REGISTER_SCOPE,
  AGENT_SESSION_REGISTER_SCOPE,
  AGENT_SESSION_REVOKE_SCOPE,
] as const;

const agentBootstrapTokenExchangeSchema = z.object({
  audience: z.url(),
  grant_type: z.string().min(1),
  requested_token_type: z.string().min(1),
  scopes_supported: z.array(z.string().min(1)),
  token_use: z.string().min(1),
});

export const agentConfigurationSchema = z.object({
  aap_claims_version: z.literal(AAP_CLAIMS_VERSION),
  act_did_emission_policy: z.literal(ACT_DID_EMISSION_POLICY),
  approval_methods: z.array(z.string().min(1)),
  approval_page_url_template: z.url(),
  bootstrap_token_exchange: agentBootstrapTokenExchangeSchema,
  capabilities_endpoint: z.url(),
  delegation_chains: z.boolean(),
  did_methods_supported: z.array(z.enum(AGENT_DID_METHODS_SUPPORTED)),
  host_registration_endpoint: z.url(),
  introspection_endpoint: z.url(),
  issuer: z.url(),
  jwks_uri: z.url(),
  registration_endpoint: z.url(),
  revocation_endpoint: z.url(),
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
