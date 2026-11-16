import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearAgentConfigurationCache,
  discoverAgentConfiguration,
} from "../../src/runtime/agent-configuration.js";

const ISSUER = "http://localhost:3000";

/** The document `/.well-known/agent-configuration` serves. */
function agentConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    issuer: ISSUER,
    aap_claims_version: 2,
    act_did_emission_policy: "never",
    delegation_chains: false,
    did_methods_supported: ["did:key"],
    registration_endpoint: `${ISSUER}/api/auth/agent/register`,
    host_registration_endpoint: `${ISSUER}/api/auth/agent/host/register`,
    capabilities_endpoint: `${ISSUER}/api/auth/agent/capabilities`,
    introspection_endpoint: `${ISSUER}/api/auth/agent/introspect`,
    revocation_endpoint: `${ISSUER}/api/auth/agent/revoke`,
    jwks_uri: `${ISSUER}/api/auth/agent/jwks`,
    supported_algorithms: ["EdDSA"],
    approval_methods: ["ciba"],
    approval_page_url_template: `${ISSUER}/approve/{auth_req_id}`,
    bootstrap_token_exchange: {
      audience: ISSUER,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scopes_supported: [
        "agent:host.register",
        "agent:session.register",
        "agent:session.revoke",
      ],
      token_use: "agent_bootstrap",
    },
    supported_features: {
      bootstrap_token_exchange: true,
      task_attestation: true,
      pairwise_agents: true,
      risk_graduated_approval: true,
      capability_constraints: true,
      delegation_chains: false,
    },
    ...overrides,
  };
}

describe("agent configuration discovery", () => {
  afterEach(() => {
    clearAgentConfigurationCache();
    vi.restoreAllMocks();
  });

  // R18: the runtime and the server agree on the claims version.
  it("accepts the version 2 document", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(agentConfiguration())
    );

    const configuration = await discoverAgentConfiguration(ISSUER);

    expect(configuration.aap_claims_version).toBe(2);
    expect(configuration.act_did_emission_policy).toBe("never");
  });

  it.each([
    ["a version 1 server", { aap_claims_version: 1 }],
    [
      "a server that emits host DIDs",
      { act_did_emission_policy: "attested_hosts_only" },
    ],
  ])("refuses %s", async (_case, overrides) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(agentConfiguration(overrides))
    );

    await expect(discoverAgentConfiguration(ISSUER)).rejects.toThrow();
  });
});
