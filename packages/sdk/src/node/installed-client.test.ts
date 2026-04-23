import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthenticateWithLoopbackBrowser, mockCreateFirstPartyAuth } =
  vi.hoisted(() => ({
    mockAuthenticateWithLoopbackBrowser: vi.fn(),
    mockCreateFirstPartyAuth: vi.fn(),
  }));

vi.mock("../fpa/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../fpa/index.js")>("../fpa/index.js");
  return {
    ...actual,
    createFirstPartyAuth: mockCreateFirstPartyAuth,
  };
});

vi.mock("./loopback-browser.js", () => ({
  authenticateWithLoopbackBrowser: mockAuthenticateWithLoopbackBrowser,
}));

import { TokenExpiredError } from "../fpa/index.js";
import {
  createInstalledClientAuth,
  deriveAppAudience,
} from "./installed-client.js";

const mockFirstPartyAuth = {
  clearClientRegistration: vi.fn(),
  clearDiscoveryCache: vi.fn(),
  clearTokens: vi.fn(),
  detectStepUp: vi.fn(),
  discover: vi.fn(),
  ensureClientRegistration: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  exchangeToken: vi.fn(),
  generatePkce: vi.fn(),
  getAccessToken: vi.fn(),
  getCachedIssuer: vi.fn(),
  getCachedJwksUri: vi.fn(),
  getOrCreateDpopClient: vi.fn(),
  loadState: vi.fn(),
  resumeAuthorization: vi.fn(),
  saveState: vi.fn(),
  stepUp: vi.fn(),
  authenticate: vi.fn(),
  authorize: vi.fn(),
};

describe("createInstalledClientAuth", () => {
  beforeEach(() => {
    mockCreateFirstPartyAuth.mockReset();
    mockAuthenticateWithLoopbackBrowser.mockReset();

    for (const mockFn of Object.values(mockFirstPartyAuth)) {
      if ("mockReset" in mockFn) {
        mockFn.mockReset();
      }
    }

    mockCreateFirstPartyAuth.mockReturnValue(mockFirstPartyAuth);
    mockFirstPartyAuth.discover.mockResolvedValue({
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      issuer: "http://localhost:3000/api/auth",
      pushed_authorization_request_endpoint:
        "http://localhost:3000/api/auth/oauth2/par",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
    });
    mockFirstPartyAuth.ensureClientRegistration.mockResolvedValue("client-1");
    mockFirstPartyAuth.getOrCreateDpopClient.mockResolvedValue({
      keyPair: {
        privateJwk: { crv: "P-256", kty: "EC" },
        publicJwk: { crv: "P-256", kty: "EC" },
      },
    });
    mockFirstPartyAuth.loadState.mockResolvedValue({
      accountSub: "user-123",
      dpopKeyPair: {
        privateJwk: { crv: "P-256", kty: "EC" },
        publicJwk: { crv: "P-256", kty: "EC" },
      },
      loginHint: "user@example.com",
    });
    mockFirstPartyAuth.getAccessToken.mockResolvedValue("login-access-token");
    mockFirstPartyAuth.exchangeToken.mockResolvedValue({
      accessToken: "app-access-token",
      accountSub: "user-123",
      expiresIn: 3600,
      loginHint: "user@example.com",
      scope: "openid",
      tokenType: "DPoP",
    });
    mockFirstPartyAuth.generatePkce.mockResolvedValue({
      codeVerifier: "verifier",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
    });
  });

  it("reuses the stored login token and exchanges it for the configured audience", async () => {
    const auth = createInstalledClientAuth({
      clientRegistrationRequest: { client_name: "Example CLI" },
      issuerUrl: "http://localhost:3000",
      loginResource: "http://localhost:3000",
      loginScope: "openid offline_access",
      storage: {
        load: vi.fn(),
        save: vi.fn(),
      },
      tokenExchangeAudience: "http://localhost:3000",
    });

    const oauth = await auth.ensureOAuthSession();

    expect(mockFirstPartyAuth.getAccessToken).toHaveBeenCalledWith({
      clientId: "client-1",
      resource: "http://localhost:3000",
    });
    expect(mockFirstPartyAuth.exchangeToken).toHaveBeenCalledWith({
      audience: "http://localhost:3000",
      clientId: "client-1",
      subjectToken: "login-access-token",
    });
    expect(oauth).toMatchObject({
      accessToken: "app-access-token",
      accountSub: "user-123",
      clientId: "client-1",
      loginHint: "user@example.com",
      scopes: ["openid"],
    });
  });

  it("opens the browser when no valid stored credentials exist", async () => {
    mockFirstPartyAuth.getAccessToken.mockRejectedValueOnce(
      new TokenExpiredError()
    );
    mockAuthenticateWithLoopbackBrowser.mockResolvedValue({
      accessToken: "browser-access-token",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid", "offline_access"],
    });

    const auth = createInstalledClientAuth({
      browserTimeoutMs: 30_000,
      clientRegistrationRequest: { client_name: "Example CLI" },
      issuerUrl: "http://localhost:3000",
      loginResource: "http://localhost:3000",
      loginScope: "openid offline_access",
      storage: {
        load: vi.fn(),
        save: vi.fn(),
      },
      tokenExchangeAudience: "http://localhost:3000",
    });

    await auth.ensureOAuthSession();

    expect(mockAuthenticateWithLoopbackBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizeEndpoint: "http://localhost:3000/api/auth/oauth2/authorize",
        clientId: "client-1",
        parEndpoint: "http://localhost:3000/api/auth/oauth2/par",
        resource: "http://localhost:3000",
        scope: "openid offline_access",
        timeoutMs: 30_000,
      })
    );
    expect(mockFirstPartyAuth.exchangeToken).toHaveBeenCalledWith({
      audience: "http://localhost:3000",
      clientId: "client-1",
      subjectToken: "browser-access-token",
    });
  });

  it("falls back to the browser when cached token refresh fails with a non-expiry error", async () => {
    mockFirstPartyAuth.getAccessToken.mockRejectedValueOnce(
      new Error('Token refresh failed: 400 {"error":"invalid_grant"}')
    );
    mockAuthenticateWithLoopbackBrowser.mockResolvedValue({
      accessToken: "browser-access-token",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid", "offline_access"],
    });

    const auth = createInstalledClientAuth({
      clientRegistrationRequest: { client_name: "Example CLI" },
      issuerUrl: "http://localhost:3000",
      loginResource: "http://localhost:3000",
      loginScope: "openid offline_access",
      storage: {
        load: vi.fn(),
        save: vi.fn(),
      },
      tokenExchangeAudience: "http://localhost:3000",
    });

    const oauth = await auth.ensureOAuthSession();

    expect(mockAuthenticateWithLoopbackBrowser).toHaveBeenCalledTimes(1);
    expect(oauth.accessToken).toBe("app-access-token");
  });

  it("falls back to the browser when the cached session token exchange fails", async () => {
    mockFirstPartyAuth.exchangeToken
      .mockRejectedValueOnce(new Error("Token exchange failed: 500"))
      .mockResolvedValueOnce({
        accessToken: "browser-app-access-token",
        accountSub: "user-123",
        expiresIn: 3600,
        loginHint: "user@example.com",
        scope: "openid",
        tokenType: "DPoP",
      });
    mockAuthenticateWithLoopbackBrowser.mockResolvedValue({
      accessToken: "browser-access-token",
      expiresAt: Date.now() + 3_600_000,
      scopes: ["openid", "offline_access"],
    });

    const auth = createInstalledClientAuth({
      clientRegistrationRequest: { client_name: "Example CLI" },
      issuerUrl: "http://localhost:3000",
      loginResource: "http://localhost:3000",
      loginScope: "openid offline_access",
      storage: {
        load: vi.fn(),
        save: vi.fn(),
      },
      tokenExchangeAudience: "http://localhost:3000",
    });

    const oauth = await auth.ensureOAuthSession();

    expect(mockAuthenticateWithLoopbackBrowser).toHaveBeenCalledTimes(1);
    expect(mockFirstPartyAuth.exchangeToken).toHaveBeenNthCalledWith(1, {
      audience: "http://localhost:3000",
      clientId: "client-1",
      subjectToken: "login-access-token",
    });
    expect(mockFirstPartyAuth.exchangeToken).toHaveBeenNthCalledWith(2, {
      audience: "http://localhost:3000",
      clientId: "client-1",
      subjectToken: "browser-access-token",
    });
    expect(oauth.accessToken).toBe("browser-app-access-token");
  });

  it("re-registers the OAuth client when browser auth reports invalid_client", async () => {
    mockFirstPartyAuth.ensureClientRegistration
      .mockResolvedValueOnce("stale-client")
      .mockResolvedValueOnce("fresh-client");
    mockFirstPartyAuth.getAccessToken
      .mockRejectedValueOnce(new TokenExpiredError())
      .mockRejectedValueOnce(new TokenExpiredError());
    mockAuthenticateWithLoopbackBrowser
      .mockRejectedValueOnce(
        new Error(
          'PAR request failed: 400 {"error":"invalid_client","error_description":"client not found"}'
        )
      )
      .mockResolvedValueOnce({
        accessToken: "fresh-browser-access-token",
        expiresAt: Date.now() + 3_600_000,
        scopes: ["openid"],
      });

    const auth = createInstalledClientAuth({
      clientRegistrationRequest: { client_name: "Example CLI" },
      issuerUrl: "http://localhost:3000",
      loginResource: "http://localhost:3000",
      loginScope: "openid offline_access",
      storage: {
        load: vi.fn(),
        save: vi.fn(),
      },
      tokenExchangeAudience: "http://localhost:3000",
    });

    const oauth = await auth.ensureOAuthSession();

    expect(mockFirstPartyAuth.clearClientRegistration).toHaveBeenCalledTimes(1);
    expect(mockFirstPartyAuth.ensureClientRegistration).toHaveBeenNthCalledWith(
      1,
      {
        request: { client_name: "Example CLI" },
      }
    );
    expect(mockFirstPartyAuth.ensureClientRegistration).toHaveBeenNthCalledWith(
      2,
      {
        force: true,
        request: { client_name: "Example CLI" },
      }
    );
    expect(oauth.clientId).toBe("fresh-client");
  });
});

describe("deriveAppAudience", () => {
  it("strips the auth issuer suffix to recover the application audience", () => {
    expect(deriveAppAudience("https://public.example/base/api/auth")).toBe(
      "https://public.example/base"
    );
  });

  it("returns the normalized issuer when the path is not an auth issuer", () => {
    expect(deriveAppAudience("https://public.example/custom/")).toBe(
      "https://public.example/custom"
    );
  });
});
