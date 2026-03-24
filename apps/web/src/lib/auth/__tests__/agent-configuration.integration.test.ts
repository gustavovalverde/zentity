import { describe, expect, it } from "vitest";

import {
  type AgentConfiguration,
  agentConfigurationSchema,
} from "@/lib/auth/oidc/agent-configuration";

/**
 * Agent Auth Protocol — Discovery Document Integration Tests
 *
 * Validates the /.well-known/agent-configuration endpoint against
 * the Agent Auth Protocol discovery specification.
 */

async function getConfiguration() {
  const { GET } = await import("@/app/.well-known/agent-configuration/route");
  return GET();
}

async function parseConfig(response: Response): Promise<AgentConfiguration> {
  return agentConfigurationSchema.parse(await response.json());
}

const URL_RE = /^https?:\/\//;

describe("Agent Auth Discovery — structure", () => {
  it("returns HTTP 200 with valid JSON", async () => {
    const response = await getConfiguration();

    expect(response.status).toBe(200);
    const config = await parseConfig(response);
    expect(config).toBeDefined();
  });

  it("includes all required top-level fields", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.issuer).toBeDefined();
    expect(config.registration_endpoint).toBeDefined();
    expect(config.host_registration_endpoint).toBeDefined();
    expect(config.capabilities_endpoint).toBeDefined();
    expect(config.introspection_endpoint).toBeDefined();
    expect(config.revocation_endpoint).toBeDefined();
    expect(config.jwks_uri).toBeDefined();
    expect(config.supported_algorithms).toBeDefined();
    expect(config.approval_methods).toBeDefined();
    expect(config.approval_page_url_template).toBeDefined();
    expect(config.bootstrap_token_exchange).toBeDefined();
    expect(config.supported_features).toBeDefined();
  });
});

describe("Agent Auth Discovery — endpoints", () => {
  it("registration endpoint points to agent register", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.registration_endpoint).toContain("/api/auth/agent/register");
  });

  it("host registration endpoint points to register-host", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.host_registration_endpoint).toContain(
      "/api/auth/agent/register-host"
    );
  });

  it("capabilities endpoint points to agent capabilities", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.capabilities_endpoint).toContain(
      "/api/auth/agent/capabilities"
    );
  });

  it("introspection endpoint points to agent introspect", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.introspection_endpoint).toContain(
      "/api/auth/agent/introspect"
    );
  });

  it("revocation endpoint points to agent revoke", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.revocation_endpoint).toContain("/api/auth/agent/revoke");
  });

  it("jwks_uri points to the agent JWKS endpoint", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.jwks_uri).toContain("/api/auth/agent/jwks");
  });

  it("approval page template points to the standalone approval page", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.approval_page_url_template).toContain(
      "/approve/{auth_req_id}"
    );
  });

  it("all endpoints use the same base URL as issuer", async () => {
    const config = await parseConfig(await getConfiguration());
    const issuer = config.issuer;

    for (const endpoint of [
      config.registration_endpoint,
      config.host_registration_endpoint,
      config.capabilities_endpoint,
      config.introspection_endpoint,
      config.revocation_endpoint,
      config.jwks_uri,
      config.approval_page_url_template,
    ]) {
      expect(endpoint).toContain(new URL(issuer).host);
    }
  });
});

describe("Agent Auth Discovery — protocol details", () => {
  it("supported_algorithms includes EdDSA", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.supported_algorithms).toContain("EdDSA");
  });

  it("approval_methods includes ciba", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.approval_methods).toContain("ciba");
  });

  it("advertises the bootstrap token exchange contract", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.bootstrap_token_exchange.audience).toBe(config.issuer);
    expect(config.bootstrap_token_exchange.grant_type).toBe(
      "urn:ietf:params:oauth:grant-type:token-exchange"
    );
    expect(config.bootstrap_token_exchange.scopes_supported).toEqual([
      "agent:host.register",
      "agent:session.register",
      "agent:session.revoke",
    ]);
    expect(config.bootstrap_token_exchange.token_use).toBe("agent_bootstrap");
  });
});

describe("Agent Auth Discovery — feature detection", () => {
  it("supported_features has all expected flags", async () => {
    const config = await parseConfig(await getConfiguration());
    const features = config.supported_features;

    expect(features.bootstrap_token_exchange).toBe(true);
    expect(features.task_attestation).toBe(true);
    expect(features.pairwise_agents).toBe(true);
    expect(features.risk_graduated_approval).toBe(true);
    expect(features.capability_constraints).toBe(true);
    expect(features.delegation_chains).toBe(false);
  });
});

describe("Agent Auth Discovery — HTTP headers", () => {
  it("Content-Type is application/json", async () => {
    const response = await getConfiguration();

    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("Cache-Control includes max-age=3600", async () => {
    const response = await getConfiguration();

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("CORS allows all origins", async () => {
    const response = await getConfiguration();

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("OPTIONS returns 204 with CORS headers", async () => {
    const { OPTIONS } = await import(
      "@/app/.well-known/agent-configuration/route"
    );
    const response = OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "GET"
    );
  });
});

describe("Agent Auth Discovery — URL resolution", () => {
  it("issuer is a valid URL", async () => {
    const config = await parseConfig(await getConfiguration());

    expect(config.issuer).toMatch(URL_RE);
  });
});
