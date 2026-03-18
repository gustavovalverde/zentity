import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryState } from "../../src/auth/discovery.js";

const credentialsMock = {
  stored: undefined as Record<string, unknown> | undefined,
};

vi.mock("../../src/auth/credentials.js", () => ({
  loadCredentials: () => credentialsMock.stored,
  updateCredentials: (_url: string, updates: Record<string, unknown>) => {
    credentialsMock.stored = {
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "",
      ...credentialsMock.stored,
      ...updates,
    };
    return credentialsMock.stored;
  },
}));

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "stdio",
  },
}));

const { ensureClientRegistration } = await import("../../src/auth/dcr.js");

const discoveryWithRegistration: DiscoveryState = {
  issuer: "http://localhost:3000/api/auth",
  token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
  authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
  registration_endpoint: "http://localhost:3000/api/auth/oauth2/register",
};

describe("DCR", () => {
  beforeEach(() => {
    credentialsMock.stored = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a new client via DCR", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: "new-client-123" }), {
        status: 200,
      })
    );

    const clientId = await ensureClientRegistration(discoveryWithRegistration);
    expect(clientId).toBe("new-client-123");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toBe("http://localhost:3000/api/auth/oauth2/register");

    const body = JSON.parse((fetchCall[1] as RequestInit).body as string);
    expect(body.client_name).toBe("@zentity/mcp-server");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.grant_types).toContain("authorization_code");
    expect(body.grant_types).toContain("urn:openid:params:grant-type:ciba");
    expect(body.grant_types).toContain(
      "urn:ietf:params:oauth:grant-type:token-exchange"
    );
  });

  it("reuses existing client_id", async () => {
    credentialsMock.stored = {
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "existing-client",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const clientId = await ensureClientRegistration(discoveryWithRegistration);
    expect(clientId).toBe("existing-client");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when no registration_endpoint in discovery", async () => {
    const noReg: DiscoveryState = {
      issuer: "http://localhost:3000/api/auth",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
    };

    await expect(ensureClientRegistration(noReg)).rejects.toThrow(
      "No registration_endpoint"
    );
  });

  it("throws on DCR failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Bad request", { status: 400 })
    );

    await expect(
      ensureClientRegistration(discoveryWithRegistration)
    ).rejects.toThrow("DCR failed: 400");
  });
});
