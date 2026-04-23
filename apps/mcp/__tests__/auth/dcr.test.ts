import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryState } from "../../src/auth/discovery.js";

const credentialsMock = {
  stored: undefined as Record<string, unknown> | undefined,
};

const { mockClearClientRegistration, mockEnsureClientRegistration } =
  vi.hoisted(() => ({
    mockClearClientRegistration: vi.fn(() => {
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
    }),
    mockEnsureClientRegistration: vi.fn(),
  }));

vi.mock("../../src/auth/credentials.js", () => ({
  clearClientRegistration: mockClearClientRegistration,
  loadCredentials: () => credentialsMock.stored,
  saveCredentials: vi.fn(),
}));

vi.mock("../../src/auth/first-party-auth.js", () => ({
  ensureFirstPartyAuth: vi.fn(() => ({
    ensureClientRegistration: mockEnsureClientRegistration,
  })),
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

describe("DCR adapter", () => {
  beforeEach(() => {
    credentialsMock.stored = undefined;
    mockClearClientRegistration.mockClear();
    mockEnsureClientRegistration.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates new client registration to the shared first-party auth client", async () => {
    mockEnsureClientRegistration.mockResolvedValue("new-client-123");

    const clientId = await ensureClientRegistration(discoveryWithRegistration);

    expect(clientId).toBe("new-client-123");
    expect(mockEnsureClientRegistration).toHaveBeenCalledWith({
      request: expect.objectContaining({
        client_name: "@zentity/mcp-server",
        grant_types: expect.arrayContaining([
          "authorization_code",
          "refresh_token",
          "urn:openid:params:grant-type:ciba",
          "urn:ietf:params:oauth:grant-type:token-exchange",
        ]),
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
  });

  it("reuses an existing DCR client with the current registration fingerprint", async () => {
    credentialsMock.stored = {
      clientId: "existing-client",
      registrationFingerprint: getInstalledAgentRegistrationFingerprint(),
      registrationMethod: "dcr",
      zentityUrl: "http://localhost:3000",
    };

    const clientId = await ensureClientRegistration(discoveryWithRegistration);

    expect(clientId).toBe("existing-client");
    expect(mockEnsureClientRegistration).not.toHaveBeenCalled();
  });

  it("ignores a cached CIMD client id and registers a DCR client instead", async () => {
    credentialsMock.stored = {
      clientId: "http://localhost:3200/.well-known/oauth-client.json",
      registrationMethod: "cimd",
      zentityUrl: "http://localhost:3000",
    };
    mockEnsureClientRegistration.mockResolvedValue("new-dcr-client");

    await expect(
      ensureClientRegistration(discoveryWithRegistration)
    ).resolves.toBe("new-dcr-client");
    expect(mockEnsureClientRegistration).toHaveBeenCalledTimes(1);
  });

  it("clears a stale DCR registration before delegating", async () => {
    credentialsMock.stored = {
      accessToken: "stale-access-token",
      clientId: "legacy-client",
      refreshToken: "stale-refresh-token",
      registrationMethod: "dcr",
      zentityUrl: "http://localhost:3000",
    };
    mockEnsureClientRegistration.mockResolvedValue("fresh-client");

    await ensureClientRegistration(discoveryWithRegistration);

    expect(mockClearClientRegistration).toHaveBeenCalledWith(
      "http://localhost:3000"
    );
    expect(mockEnsureClientRegistration).toHaveBeenCalledTimes(1);
  });

  it("passes force through to the shared client when requested", async () => {
    mockEnsureClientRegistration.mockResolvedValue("fresh-client");

    await expect(
      ensureClientRegistration(discoveryWithRegistration, {
        force: true,
      })
    ).resolves.toBe("fresh-client");

    expect(mockEnsureClientRegistration).toHaveBeenCalledWith({
      force: true,
      request: expect.any(Object),
    });
  });

  it("throws when discovery does not expose a registration endpoint", async () => {
    const noRegistrationEndpoint: DiscoveryState = {
      issuer: "http://localhost:3000/api/auth",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
    };

    await expect(
      ensureClientRegistration(noRegistrationEndpoint)
    ).rejects.toThrow("No registration_endpoint");
    expect(mockEnsureClientRegistration).not.toHaveBeenCalled();
  });

  it("surfaces shared-client DCR failures", async () => {
    mockEnsureClientRegistration.mockRejectedValue(
      new Error("DCR failed: 400 Bad request")
    );

    await expect(
      ensureClientRegistration(discoveryWithRegistration)
    ).rejects.toThrow("DCR failed: 400");
  });
});
