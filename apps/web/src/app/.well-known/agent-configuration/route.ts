import { env } from "@/env";

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

function buildAgentConfiguration() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  return {
    issuer: baseUrl,

    // Registration
    registration_endpoint: `${baseUrl}/api/auth/agent/register`,
    host_registration_endpoint: `${baseUrl}/api/auth/agent/register-host`,

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
    issued_token_types: ["urn:zentity:token-type:purchase-authorization"],

    // Feature detection
    supported_features: {
      task_attestation: true,
      pairwise_agents: true,
      risk_graduated_approval: true,
      capability_constraints: true,
      delegation_chains: false,
    },
  };
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
