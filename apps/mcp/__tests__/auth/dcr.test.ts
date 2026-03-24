import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryState } from "../../src/auth/discovery.js";

const credentialsMock = {
  stored: undefined as Record<string, unknown> | undefined,
};

vi.mock("../../src/auth/credentials.js", () => ({
  clearClientRegistration: () => {
    if (!credentialsMock.stored) {
      return;
    }
    const {
      accessToken: _accessToken,
      clientId: _clientId,
      clientSecret: _clientSecret,
      expiresAt: _expiresAt,
      refreshToken: _refreshToken,
      registrationFingerprint: _registrationFingerprint,
      registrationMethod: _registrationMethod,
      ...rest
    } = credentialsMock.stored;
    credentialsMock.stored = {
      ...rest,
      zentityUrl: "http://localhost:3000",
      clientId: "",
    };
  },
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
const { getInstalledAgentRegistrationFingerprint } = await import(
  "../../src/auth/auth-surfaces.js"
);

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
    expect(body.skip_consent).toBeUndefined();
    expect(body.grant_types).toContain("authorization_code");
    expect(body.grant_types).toContain("urn:openid:params:grant-type:ciba");
    expect(body.grant_types).toContain(
      "urn:ietf:params:oauth:grant-type:token-exchange"
    );
    expect(body.scope).toContain("openid");
    expect(body.scope).toContain("email");
    expect(body.scope).toContain("offline_access");
    expect(body.scope).not.toContain("proof:identity");
    expect(body.scope).not.toContain("compliance:key:read");
    expect(body.scope).not.toContain("agent:host.register");
    expect(body.subject_type).toBeUndefined();
  });

  it("reuses existing client_id", async () => {
    const registrationFingerprint = getInstalledAgentRegistrationFingerprint();
    credentialsMock.stored = {
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "existing-client",
      registrationFingerprint,
      registrationMethod: "dcr",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const clientId = await ensureClientRegistration(discoveryWithRegistration);
    expect(clientId).toBe("existing-client");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not reuse a cached CIMD client_id for stdio DCR", async () => {
    credentialsMock.stored = {
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "http://localhost:3200/.well-known/oauth-client.json",
      registrationMethod: "cimd",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: "new-dcr-client" }), {
        status: 200,
      })
    );

    const clientId = await ensureClientRegistration(discoveryWithRegistration);
    expect(clientId).toBe("new-dcr-client");
  });

  it("re-registers a legacy cached DCR client without a registration fingerprint", async () => {
    credentialsMock.stored = {
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "legacy-client",
      registrationMethod: "dcr",
      accessToken: "stale-access-token",
      refreshToken: "stale-refresh-token",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: "fresh-client" }), {
        status: 200,
      })
    );

    const clientId = await ensureClientRegistration(discoveryWithRegistration);
    expect(clientId).toBe("fresh-client");
    expect(credentialsMock.stored).toEqual(
      expect.objectContaining({
        clientId: "fresh-client",
        registrationFingerprint: getInstalledAgentRegistrationFingerprint(),
        registrationMethod: "dcr",
      })
    );
    expect(credentialsMock.stored).not.toHaveProperty("accessToken");
    expect(credentialsMock.stored).not.toHaveProperty("refreshToken");
  });

  it("re-registers when forced", async () => {
    credentialsMock.stored = {
      zentityUrl: "http://localhost:3000",
      mcpPublicUrl: "http://localhost:3200",
      clientId: "stale-client",
      registrationMethod: "dcr",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ client_id: "fresh-client" }), {
        status: 200,
      })
    );

    const clientId = await ensureClientRegistration(discoveryWithRegistration, {
      force: true,
    });
    expect(clientId).toBe("fresh-client");
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
