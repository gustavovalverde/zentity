import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAuthenticateWithLoopbackBrowser,
  mockCreateFirstPartyAuth,
  mockExchangeToken,
  mockFetchUserInfo,
} = vi.hoisted(() => ({
  mockAuthenticateWithLoopbackBrowser: vi.fn(),
  mockCreateFirstPartyAuth: vi.fn(),
  mockExchangeToken: vi.fn(),
  mockFetchUserInfo: vi.fn(),
}));

vi.mock("../fpa/index", async () => {
  const actual =
    await vi.importActual<typeof import("../fpa/index")>("../fpa/index");
  return {
    ...actual,
    createFirstPartyAuth: mockCreateFirstPartyAuth,
    exchangeToken: mockExchangeToken,
  };
});

vi.mock("./loopback-browser", () => ({
  authenticateWithLoopbackBrowser: mockAuthenticateWithLoopbackBrowser,
}));

vi.mock("../rp/userinfo", () => ({ fetchUserInfo: mockFetchUserInfo }));

import { TokenExpiredError, TokenRefreshError } from "../fpa/index";
import {
  createInstalledClientAuth,
  deriveAppAudience,
} from "./installed-client";

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
    mockExchangeToken.mockReset();
    mockFetchUserInfo.mockReset();
    mockFetchUserInfo.mockResolvedValue({ sub: "userinfo-sub" });

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
      userinfo_endpoint: "http://localhost:3000/api/auth/oauth2/userinfo",
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
      scopes: ["openid", "agent:host.register"],
    });
    mockFirstPartyAuth.getAccessToken.mockResolvedValue("login-access-token");
    mockFirstPartyAuth.generatePkce.mockResolvedValue({
      codeVerifier: "verifier",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
    });
  });

  // R13: the installed client no longer exchanges its own login.
  it("uses the stored login token as the session and names the account from UserInfo", async () => {
    const auth = createInstalledClientAuth({
      clientRegistrationRequest: { client_name: "Example CLI" },
      issuerUrl: "http://localhost:3000",
      loginResource: "http://localhost:3000",
      loginScope: "openid offline_access",
      storage: {
        load: vi.fn(),
        save: vi.fn(),
      },
    });

    const oauth = await auth.ensureOAuthSession();

    expect(mockFirstPartyAuth.getAccessToken).toHaveBeenCalledWith({
      clientId: "client-1",
      resource: "http://localhost:3000",
    });
    expect(mockFetchUserInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "login-access-token",
        userInfoUrl: "http://localhost:3000/api/auth/oauth2/userinfo",
      })
    );
    expect(mockFirstPartyAuth.exchangeToken).not.toHaveBeenCalled();
    expect(oauth).toMatchObject({
      accessToken: "login-access-token",
      accountSub: "userinfo-sub",
      clientId: "client-1",
      scopes: ["openid", "agent:host.register"],
    });
  });

  it("returns the persisted client signer and discovered issuer audience", async () => {
    const privateJwk = {
      crv: "P-256",
      d: "private",
      kty: "EC" as const,
      x: "x",
      y: "y",
    };
    mockFirstPartyAuth.loadState.mockResolvedValue({
      clientAuthMethod: "private_key_jwt",
      clientAuthKeyPair: {
        privateJwk,
        publicJwk: { crv: "P-256", kty: "EC", x: "x", y: "y" },
      },
      dpopKeyPair: {
        privateJwk: { crv: "P-256", kty: "EC" },
        publicJwk: { crv: "P-256", kty: "EC" },
      },
      scopes: ["openid"],
    });
    const auth = createInstalledClientAuth({
      clientRegistrationRequest: { client_name: "Example CLI" },
      issuerUrl: "http://localhost:3000",
      loginScope: "openid offline_access",
      privateKeyJwt: true,
      storage: { load: vi.fn(), save: vi.fn() },
    });

    const session = await auth.ensureOAuthSession();

    expect(mockFirstPartyAuth.ensureClientRegistration).toHaveBeenCalledWith({
      request: { client_name: "Example CLI" },
      privateKeyJwt: true,
    });
    expect(session.clientAuth).toEqual({
      clientAssertionAudience: "http://localhost:3000/api/auth",
      privateJwk,
      signingAlgorithm: "ES256",
    });
  });

  it("exchanges the stored login token for a token limited to the requested scope", async () => {
    mockExchangeToken.mockResolvedValue({
      accessToken: "bootstrap-access-token",
      expiresIn: 3600,
      scope: "agent:host.register",
      tokenType: "DPoP",
    });
    const auth = createInstalledClientAuth({
      clientRegistrationRequest: { client_name: "Example CLI" },
      issuerUrl: "http://localhost:3000",
      loginResource: "http://localhost:3000",
      loginScope: "openid offline_access agent:host.register",
      storage: {
        load: vi.fn(),
        save: vi.fn(),
      },
    });

    const token = await auth.exchangeLoginToken({
      audience: "http://localhost:3000",
      scope: "agent:host.register",
    });

    expect(mockFirstPartyAuth.getAccessToken).toHaveBeenCalledWith({
      clientId: "client-1",
      resource: "http://localhost:3000",
    });
    expect(mockExchangeToken).toHaveBeenCalledWith({
      audience: "http://localhost:3000",
      clientId: "client-1",
      dpopClient: await mockFirstPartyAuth.getOrCreateDpopClient(),
      scope: "agent:host.register",
      subjectToken: "login-access-token",
      tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
    });
    expect(mockFirstPartyAuth.exchangeToken).not.toHaveBeenCalled();
    expect(token.accessToken).toBe("bootstrap-access-token");
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
    expect(mockFirstPartyAuth.exchangeToken).not.toHaveBeenCalled();
  });

  it("falls back to the browser when cached token refresh fails with a non-expiry error", async () => {
    mockFirstPartyAuth.getAccessToken.mockRejectedValueOnce(
      new TokenRefreshError(400, '{"error":"invalid_grant"}')
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
    });

    const oauth = await auth.ensureOAuthSession();

    expect(mockAuthenticateWithLoopbackBrowser).toHaveBeenCalledTimes(1);
    expect(oauth.accessToken).toBe("browser-access-token");
  });

  it("falls back to the browser when UserInfo refuses the stored login token", async () => {
    mockFetchUserInfo.mockResolvedValueOnce(null);
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
    });

    const oauth = await auth.ensureOAuthSession();

    expect(mockAuthenticateWithLoopbackBrowser).toHaveBeenCalledTimes(1);
    expect(mockFetchUserInfo).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ accessToken: "browser-access-token" })
    );
    expect(oauth.accessToken).toBe("browser-access-token");
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
