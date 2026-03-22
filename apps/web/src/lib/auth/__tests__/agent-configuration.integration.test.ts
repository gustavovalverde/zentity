import { describe, expect, it } from "vitest";

/**
 * Agent Auth Protocol — Discovery Document Integration Tests
 *
 * Validates the /.well-known/agent-configuration endpoint against
 * the Agent Auth Protocol discovery specification.
 */

interface AgentConfiguration {
  approval_methods: string[];
  approval_page_url_template: string;
  capabilities_endpoint: string;
  host_registration_endpoint: string;
  introspection_endpoint: string;
  issuer: string;
  jwks_uri: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  supported_algorithms: string[];
  supported_features: {
    task_attestation: boolean;
    pairwise_agents: boolean;
    risk_graduated_approval: boolean;
    capability_constraints: boolean;
    delegation_chains: boolean;
  };
}

async function getConfiguration() {
  const { GET } = await import("@/app/.well-known/agent-configuration/route");
  return GET();
}

function parseConfig(response: Response): Promise<AgentConfiguration> {
  return response.json() as Promise<AgentConfiguration>;
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
});

describe("Agent Auth Discovery — feature detection", () => {
  it("supported_features has all expected flags", async () => {
    const config = await parseConfig(await getConfiguration());
    const features = config.supported_features;

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
