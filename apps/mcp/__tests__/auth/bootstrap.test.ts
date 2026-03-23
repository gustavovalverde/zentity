import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryState } from "../../src/auth/discovery.js";

const {
  mockAuthenticateViaBrowser,
  mockClearClientRegistration,
  mockDiscover,
  mockEnsureClientRegistration,
  mockExchangeToken,
  mockGeneratePkce,
  mockGetAccessToken,
  mockGetOrCreateDpopKey,
  mockLoadCredentials,
} = vi.hoisted(() => ({
  mockAuthenticateViaBrowser: vi.fn(),
  mockClearClientRegistration: vi.fn(),
  mockDiscover: vi.fn(),
  mockEnsureClientRegistration: vi.fn(),
  mockExchangeToken: vi.fn(),
  mockGeneratePkce: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetOrCreateDpopKey: vi.fn(),
  mockLoadCredentials: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
  },
}));

vi.mock("../../src/auth/browser-redirect.js", () => ({
  authenticateViaBrowser: mockAuthenticateViaBrowser,
}));

vi.mock("../../src/auth/credentials.js", () => ({
  clearClientRegistration: mockClearClientRegistration,
  loadCredentials: mockLoadCredentials,
}));

vi.mock("../../src/auth/dcr.js", () => ({
  ensureClientRegistration: mockEnsureClientRegistration,
}));

vi.mock("../../src/auth/discovery.js", () => ({
  discover: mockDiscover,
}));

vi.mock("../../src/auth/dpop.js", () => ({
  getOrCreateDpopKey: mockGetOrCreateDpopKey,
}));

vi.mock("../../src/auth/pkce.js", () => ({
  generatePkce: mockGeneratePkce,
}));

vi.mock("../../src/auth/token-exchange.js", () => ({
  exchangeToken: mockExchangeToken,
}));

vi.mock("../../src/auth/token-manager.js", () => ({
  TokenManager: class MockTokenManager {
    getAccessToken = mockGetAccessToken;
  },
}));

const { ensureAuthenticated } = await import("../../src/auth/bootstrap.js");

const discovery: DiscoveryState = {
  issuer: "http://localhost:3000/api/auth",
  token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
  authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
  registration_endpoint: "http://localhost:3000/api/auth/oauth2/register",
  pushed_authorization_request_endpoint:
    "http://localhost:3000/api/auth/oauth2/par",
};

const dpopKey = {
  privateJwk: { crv: "P-256", kty: "EC" },
  publicJwk: { crv: "P-256", kty: "EC" },
};

describe("ensureAuthenticated", () => {
  beforeEach(() => {
    mockAuthenticateViaBrowser.mockReset();
    mockClearClientRegistration.mockReset();
    mockDiscover.mockReset();
    mockEnsureClientRegistration.mockReset();
    mockGeneratePkce.mockReset();
    mockGetAccessToken.mockReset();
    mockGetOrCreateDpopKey.mockReset();
    mockLoadCredentials.mockReset();

    mockDiscover.mockResolvedValue(discovery);
    mockExchangeToken.mockResolvedValue({
      accessToken: "app-access-token",
      expiresIn: 3600,
      tokenType: "DPoP",
    });
    mockGetOrCreateDpopKey.mockResolvedValue(dpopKey);
    mockGeneratePkce.mockResolvedValue({
      codeVerifier: "verifier",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
    });
    mockLoadCredentials.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-registers the OAuth client when PAR returns invalid_client", async () => {
    mockEnsureClientRegistration
      .mockResolvedValueOnce("stale-client")
      .mockResolvedValueOnce("fresh-client");
    mockAuthenticateViaBrowser
      .mockRejectedValueOnce(
        new Error(
          'PAR request failed: 400 {"error":"invalid_client","error_description":"client not found"}'
        )
      )
      .mockResolvedValueOnce({
        accessToken: "fresh-access-token",
        expiresAt: Date.now() + 3600_000,
        loginHint: "user-123",
      });

    const result = await ensureAuthenticated();

    expect(mockClearClientRegistration).toHaveBeenCalledWith(
      "http://localhost:3000"
    );
    expect(mockEnsureClientRegistration).toHaveBeenNthCalledWith(1, discovery);
    expect(mockEnsureClientRegistration).toHaveBeenNthCalledWith(2, discovery, {
      force: true,
    });
    expect(mockAuthenticateViaBrowser).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        clientId: "stale-client",
      })
    );
    expect(mockAuthenticateViaBrowser).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        clientId: "fresh-client",
      })
    );
    expect(mockExchangeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "http://localhost:3000",
        clientId: "fresh-client",
        subjectToken: "fresh-access-token",
      })
    );
    expect(result.oauth.clientId).toBe("fresh-client");
    expect(result.oauth.accessToken).toBe("app-access-token");
    expect(result.oauth.loginHint).toBe("user-123");
  });
});
