import {
  AAP_CLAIMS_VERSION,
  ACT_DID_EMISSION_POLICY,
  AGENT_DID_METHODS_SUPPORTED,
} from "@zentity/sdk/protocol";

import { env } from "@/env";
import {
  AGENT_BOOTSTRAP_SCOPES,
  AGENT_BOOTSTRAP_TOKEN_USE,
  type AgentConfiguration,
  agentConfigurationSchema,
} from "@/lib/agents/session";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "@/lib/auth/oidc/token-exchange";

/**
 * Agent Auth Protocol — Discovery Document
 *
 * Returns the agent authentication configuration at
 * /.well-known/agent-configuration per the Agent Auth Protocol spec.
 *
 * Allows external tools and MCP servers to discover Zentity's agent
 * registration, capabilities, introspection, and revocation endpoints
 * programmatically.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function buildAgentConfiguration(): AgentConfiguration {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  return agentConfigurationSchema.parse({
    issuer: baseUrl,
    aap_claims_version: AAP_CLAIMS_VERSION,
    act_did_emission_policy: ACT_DID_EMISSION_POLICY,
    delegation_chains: false,
    did_methods_supported: [...AGENT_DID_METHODS_SUPPORTED],

    // Registration
    registration_endpoint: `${baseUrl}/api/auth/agent/register`,
    host_registration_endpoint: `${baseUrl}/api/auth/agent/host/register`,

    // Capabilities
    capabilities_endpoint: `${baseUrl}/api/auth/agent/capabilities`,

    // Introspection & lifecycle
    introspection_endpoint: `${baseUrl}/api/auth/agent/introspect`,
    revocation_endpoint: `${baseUrl}/api/auth/agent/revoke`,

    // Keys
    jwks_uri: `${baseUrl}/api/auth/agent/jwks`,

    // Protocol details
    supported_algorithms: ["EdDSA"],
    approval_methods: ["ciba"],
    approval_page_url_template: `${baseUrl}/approve/{auth_req_id}`,
    bootstrap_token_exchange: {
      audience: baseUrl,
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scopes_supported: AGENT_BOOTSTRAP_SCOPES,
      token_use: AGENT_BOOTSTRAP_TOKEN_USE,
    },

    // Feature detection
    supported_features: {
      bootstrap_token_exchange: true,
      task_attestation: true,
      pairwise_agents: true,
      risk_graduated_approval: true,
      capability_constraints: true,
      delegation_chains: false,
    },
  });
}

export function GET() {
  return new Response(JSON.stringify(buildAgentConfiguration()), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
