import { describe, expect, it } from "vitest";
import {
  AGENT_BOOTSTRAP_SCOPES,
  agentConfigurationSchema,
} from "./agent-contract";

const ISSUER = "https://zentity.example";

function configurationDocument() {
  return {
    aap_claims_version: 1,
    act_did_emission_policy: "never",
    approval_methods: ["ciba"],
    approval_page_url_template: `${ISSUER}/approve/{request_id}`,
    bootstrap_token_exchange: {
      audience: ISSUER,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scopes_supported: [...AGENT_BOOTSTRAP_SCOPES],
      token_use: "agent_bootstrap",
    },
    capabilities_endpoint: `${ISSUER}/api/auth/agent/capabilities`,
    delegation_chains: false,
    did_methods_supported: ["did:key"],
    host_registration_endpoint: `${ISSUER}/api/auth/agent/host/register`,
    introspection_endpoint: `${ISSUER}/api/auth/agent/introspect`,
    issuer: ISSUER,
    jwks_uri: `${ISSUER}/api/auth/jwks`,
    registration_endpoint: `${ISSUER}/api/auth/agent/register`,
    revocation_endpoint: `${ISSUER}/api/auth/agent/revoke`,
    supported_algorithms: ["EdDSA"],
    supported_features: {
      bootstrap_token_exchange: true,
      task_attestation: true,
      pairwise_agents: true,
      risk_graduated_approval: true,
      capability_constraints: true,
      delegation_chains: false,
    },
  };
}

describe("agent contract", () => {
  it("lists the bootstrap scopes agents request", () => {
    expect(AGENT_BOOTSTRAP_SCOPES).toEqual([
      "agent:host.register",
      "agent:session.register",
      "agent:session.revoke",
    ]);
  });

  it("accepts a complete agent-configuration document", () => {
    expect(
      agentConfigurationSchema.parse(configurationDocument()).revocation_endpoint
    ).toBe(`${ISSUER}/api/auth/agent/revoke`);
  });

  it("rejects a document with an unsupported claims version", () => {
    expect(() =>
      agentConfigurationSchema.parse({
        ...configurationDocument(),
        aap_claims_version: 2,
      })
    ).toThrow();
  });
});
