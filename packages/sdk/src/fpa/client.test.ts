import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DpopClient, DpopKeyPair } from "../rp/dpop-client";

const TEST_KEY_PAIR: DpopKeyPair = {
  privateJwk: {
    crv: "P-256",
    d: "private",
    kty: "EC",
    x: "pub-x",
    y: "pub-y",
  },
  publicJwk: {
    crv: "P-256",
    kty: "EC",
    x: "pub-x",
    y: "pub-y",
  },
};

const TEST_PKCE = {
  codeChallenge: "challenge-123",
  codeChallengeMethod: "S256" as const,
  codeVerifier: "verifier-123",
};

const mockDpopClient = {
  keyPair: TEST_KEY_PAIR,
  proofFor: vi.fn().mockResolvedValue("mock-dpop-proof"),
  fetch: (url: string | URL, init?: RequestInit) => globalThis.fetch(url, init),
} satisfies DpopClient;

const fpaMocks = vi.hoisted(() => ({
  createDpopClientFromKeyPair: vi.fn(async () => mockDpopClient),
  exchangeAuthorizationCode: vi.fn(),
  exchangeToken: vi.fn(),
  finishLogin: vi.fn(),
  generateDpopKeyPair: vi.fn(async () => TEST_KEY_PAIR),
  generatePkceChallenge: vi.fn(async () => TEST_PKCE),
  startLogin: vi.fn(),
}));

vi.mock("../rp/dpop-client", () => ({
  createDpopClientFromKeyPair: fpaMocks.createDpopClientFromKeyPair,
  generateDpopKeyPair: fpaMocks.generateDpopKeyPair,
}));

vi.mock("@serenity-kit/opaque", () => ({
  client: {
    finishLogin: fpaMocks.finishLogin,
    startLogin: fpaMocks.startLogin,
  },
  ready: Promise.resolve(),
}));

vi.mock("./oauth", () => ({
  exchangeAuthorizationCode: fpaMocks.exchangeAuthorizationCode,
  exchangeToken: fpaMocks.exchangeToken,
}));

vi.mock("./pkce", async () => {
  const actual = await vi.importActual<typeof import("./pkce")>("./pkce");
  return {
    ...actual,
    generatePkceChallenge: fpaMocks.generatePkceChallenge,
  };
});

import {
  createFirstPartyAuth,
  detectStepUp,
  RedirectToWebError,
  StepUpRequiredError,
  TokenExpiredError,
  TokenRefreshError,
} from "./client";

function createMemoryAuthStateStorage(initialState?: Record<string, unknown>) {
  let state = initialState;

  return {
    read() {
      return state;
    },
    storage: {
      load: vi.fn(async () => state),
      save: vi.fn(async (nextState: Record<string, unknown>) => {
        state = nextState;
      }),
    },
  };
}

describe("createFirstPartyAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects claims without openid before contacting the issuer", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      auth.authenticate({
        claims: JSON.stringify({ userinfo: { name: null } }),
        clientId: "client-123",
        identifier: "user@example.com",
        scope: "profile",
        strategies: {
          password: {
            password: "correct horse battery staple",
          },
        },
      })
    ).rejects.toThrow("claims requires scope to include openid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("authenticates through the OPAQUE challenge flow", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });

    fpaMocks.startLogin.mockReturnValue({
      clientLoginState: "client-state",
      startLoginRequest: "opaque-start-request",
    });
    fpaMocks.finishLogin.mockReturnValue({
      exportKey: "export-key",
      finishLoginRequest: "opaque-finish-request",
      serverStaticPublicKey: "server-public-key",
    });
    fpaMocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: "access-token",
      accountSub: "pairwise-subject",
      authSession: "auth-session-rotated",
      expiresAt: Date.now() + 3_600_000,
      loginHint: "user@example.com",
      refreshToken: "refresh-token",
      scopes: ["openid", "offline_access"],
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_challenge_endpoint:
              "https://issuer.example/api/oauth2/authorize-challenge",
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_session: "auth-session-1",
            challenge_type: "opaque",
            error: "insufficient_authorization",
            server_public_key: "server-public-key",
          }),
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_session: "auth-session-1",
            challenge_type: "opaque",
            error: "insufficient_authorization",
            opaque_login_response: "opaque-login-response",
          }),
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_code: "authorization-code-1",
          }),
          { status: 200 }
        )
      );

    const result = await auth.authenticate({
      clientId: "client-123",
      identifier: "user@example.com",
      scope: "openid offline_access",
      strategies: {
        password: {
          password: "correct horse battery staple",
        },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        accessToken: "access-token",
        authSession: "auth-session-rotated",
        exportKey: "export-key",
        loginMethod: "opaque",
      })
    );
    const exchange = fpaMocks.exchangeAuthorizationCode.mock.calls[0]?.[1];
    expect(exchange).toEqual(
      expect.objectContaining({
        clientId: "client-123",
        code: "authorization-code-1",
        codeVerifier: TEST_PKCE.codeVerifier,
      })
    );
    // A challenge code is bound to no redirect_uri (draft §6).
    expect(exchange).not.toHaveProperty("redirectUri");
    // The token response's auth_session replaces the challenge's.
    expect(authStateStorage.read()).toEqual(
      expect.objectContaining({
        accessToken: "access-token",
        authSession: "auth-session-rotated",
        clientId: "client-123",
        dpopKeyPair: TEST_KEY_PAIR,
        refreshToken: "refresh-token",
      })
    );

    const [, round1] = fetchSpy.mock.calls[1]!;
    const round1Init = round1 as RequestInit;
    expect(new Headers(round1Init.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded"
    );
    const round1Body = new URLSearchParams(round1Init.body as string);
    expect(round1Body.get("login_hint")).toBe("user@example.com");
    expect(round1Body.get("response_type")).toBe("code");
    expect(round1Body.has("identifier")).toBe(false);
    expect(round1Body.has("redirect_uri")).toBe(false);

    const [, round2] = fetchSpy.mock.calls[2]!;
    const round2Init = round2 as RequestInit;
    expect(new Headers(round2Init.headers).get("content-type")).toBe(
      "application/json"
    );
    expect(JSON.parse(round2Init.body as string)).toEqual({
      auth_session: "auth-session-1",
      opaque_login_request: "opaque-start-request",
    });
  });

  it("raises StepUpRequiredError when the code waits for a higher assurance tier", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });
    fpaMocks.startLogin.mockReturnValue({
      clientLoginState: "client-state",
      startLoginRequest: "opaque-start-request",
    });
    fpaMocks.finishLogin.mockReturnValue({
      exportKey: "export-key",
      finishLoginRequest: "opaque-finish-request",
      serverStaticPublicKey: "server-public-key",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_challenge_endpoint:
              "https://issuer.example/api/oauth2/authorize-challenge",
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_session: "auth-session-1",
            challenge_type: "opaque",
            error: "insufficient_authorization",
          }),
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_session: "auth-session-1",
            challenge_type: "opaque",
            error: "insufficient_authorization",
            opaque_login_response: "opaque-login-response",
          }),
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_session: "auth-session-1",
            error: "insufficient_authorization",
            error_description: "User assurance is tier-0",
          }),
          { status: 403 }
        )
      );

    await expect(
      auth.authorize({
        clientId: "client-123",
        identifier: "user@example.com",
        pkce: TEST_PKCE,
        scope: "openid",
        strategies: { password: { password: "correct horse battery staple" } },
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<StepUpRequiredError>>({
        authSession: "auth-session-1",
        name: "StepUpRequiredError",
      })
    );
  });

  it("refreshes exchanged tokens without an explicit client id", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });

    fpaMocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: "expired-access-token",
      expiresAt: Date.now() - 5000,
      refreshToken: "refresh-token",
      scopes: ["openid"],
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "refreshed-access-token",
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

    await auth.exchangeAuthorizationCode({
      clientId: "static-client",
      code: "authorization-code",
      codeVerifier: "code-verifier",
      redirectUri: "http://127.0.0.1/callback",
    });

    await expect(auth.getAccessToken()).resolves.toBe("refreshed-access-token");

    const [, refreshRequest] = vi.mocked(fetch).mock.calls[1]!;
    const body = new URLSearchParams(
      (refreshRequest as RequestInit).body as string
    );
    expect(body.get("client_id")).toBe("static-client");
  });

  it("surfaces redirect-to-web responses from the challenge endpoint", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_challenge_endpoint:
              "https://issuer.example/api/oauth2/authorize-challenge",
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "redirect_to_web",
            error_description: "The user must continue in the browser",
          }),
          { status: 403 }
        )
      );

    await expect(
      auth.authorize({
        clientId: "client-123",
        identifier: "passkey@example.com",
        pkce: TEST_PKCE,
        scope: "openid",
        strategies: {
          password: {
            password: "irrelevant",
          },
        },
      })
    ).rejects.toBeInstanceOf(RedirectToWebError);
  });

  it("completes wallet-based authorization by signing the SIWE message", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });
    const siweMessage = [
      "https://issuer.example wants you to sign in with your Ethereum account:",
      "0x0000000000000000000000000000000000000001",
      "",
      "Sign in to Zentity from a first-party app.",
      "",
      "URI: https://issuer.example",
      "Version: 1",
      "Chain ID: 1",
      "Nonce: abcdefgh12345678",
      "Issued At: 2026-01-01T00:00:00.000Z",
    ].join("\n");
    const signMessage = vi.fn(async () => "wallet-signature");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_challenge_endpoint:
              "https://issuer.example/api/oauth2/authorize-challenge",
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            auth_session: "wallet-session-1",
            challenge_type: "siwe",
            error: "insufficient_authorization",
            message: siweMessage,
          }),
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_code: "wallet-authorization-code",
          }),
          { status: 200 }
        )
      );

    const result = await auth.authorize({
      clientId: "client-123",
      identifier: "0xabc123",
      pkce: TEST_PKCE,
      scope: "openid",
      strategies: {
        wallet: {
          chainId: 1,
          signMessage,
        },
      },
    });

    expect(signMessage).toHaveBeenCalledExactlyOnceWith(siweMessage);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      auth_session: "wallet-session-1",
      siwe_signature: "wallet-signature",
    });
    expect(result).toEqual({
      authSession: "wallet-session-1",
      authorizationCode: "wallet-authorization-code",
      loginMethod: "eip712",
    });
  });

  it("reuses the stored DCR client registration for the same request", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            registration_endpoint: "https://issuer.example/oauth/register",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: "registered-client-1",
          }),
          { status: 200 }
        )
      );

    const request = {
      client_name: "@zentity/mcp-server",
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "none",
    };

    expect(
      await auth.ensureClientRegistration({
        request,
      })
    ).toBe("registered-client-1");
    expect(
      await auth.ensureClientRegistration({
        request,
      })
    ).toBe("registered-client-1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clears token state when a new DCR client is registered", async () => {
    const authStateStorage = createMemoryAuthStateStorage({
      accessToken: "stale-access-token",
      clientId: "stale-client",
      expiresAt: Date.now() + 60_000,
      refreshToken: "stale-refresh-token",
      registrationMethod: "dcr",
    });
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            registration_endpoint: "https://issuer.example/oauth/register",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: "registered-client-2",
          }),
          { status: 200 }
        )
      );

    await auth.ensureClientRegistration({
      force: true,
      request: {
        client_name: "@zentity/mcp-server",
      },
    });

    expect(authStateStorage.read()).toEqual({
      clientId: "registered-client-2",
      registrationFingerprint: '{"client_name":"@zentity/mcp-server"}',
      registrationMethod: "dcr",
    });
  });

  it("registers a persistent ES256 key for installed private_key_jwt clients", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issuer: "https://issuer.example",
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            registration_endpoint: "https://issuer.example/oauth/register",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            client_id: "installed-client",
          }),
          { status: 200 }
        )
      );

    await auth.ensureClientRegistration({
      privateKeyJwt: true,
      request: { client_name: "Installed client" },
    });

    const requestBody = JSON.parse(
      String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(requestBody.token_endpoint_auth_method).toBe("private_key_jwt");
    expect(requestBody.token_endpoint_auth_signing_alg).toBe("ES256");
    expect(
      (requestBody.jwks as { keys: Record<string, unknown>[] }).keys
    ).toMatchObject([{ kty: "EC", crv: "P-256", alg: "ES256" }]);
    const persisted = authStateStorage.read() as {
      clientAuthKeyPair?: { privateJwk?: unknown; publicJwk?: unknown };
      clientAuthMethod?: string;
    };
    expect(persisted.clientAuthKeyPair?.privateJwk).toBeDefined();
    expect(persisted.clientAuthKeyPair?.publicJwk).toBeDefined();
    expect(persisted.clientAuthMethod).toBe("private_key_jwt");
  });

  it("keeps a public client usable when private DCR fails", async () => {
    const initialState = {
      accessToken: "expired-public-token",
      clientId: "public-client",
      expiresAt: Date.now() - 5000,
      refreshToken: "public-refresh-token",
      registrationFingerprint: '{"client_name":"Installed client"}',
      registrationMethod: "dcr" as const,
      scopes: ["openid"],
    };
    const authStateStorage = createMemoryAuthStateStorage(initialState);
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            registration_endpoint: "https://issuer.example/oauth/register",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response("DCR unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "refreshed-public-token" }),
          { status: 200 }
        )
      );

    await expect(
      auth.ensureClientRegistration({
        privateKeyJwt: true,
        request: { client_name: "Installed client" },
      })
    ).rejects.toThrow("DCR failed: 503 DCR unavailable");
    expect(authStateStorage.read()).toEqual(initialState);

    await expect(auth.getAccessToken()).resolves.toBe("refreshed-public-token");
    const refreshRequest = fetchSpy.mock.calls[2]?.[1] as RequestInit;
    const body = new URLSearchParams(refreshRequest.body as string);
    expect(body.get("client_id")).toBe("public-client");
    expect(body.has("client_assertion")).toBe(false);
    expect(new Headers(refreshRequest.headers).has("Authorization")).toBe(
      false
    );
  });

  it("drops the signing key when a client opts back out of private_key_jwt", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            registration_endpoint: "https://issuer.example/oauth/register",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: "signed-client" }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ client_id: "public-client" }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "refreshed-public-token",
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

    await auth.ensureClientRegistration({
      privateKeyJwt: true,
      request: { client_name: "Signed client" },
    });
    expect(authStateStorage.read()).toMatchObject({
      clientAuthMethod: "private_key_jwt",
      clientId: "signed-client",
    });

    await auth.ensureClientRegistration({
      force: true,
      request: { client_name: "Public client" },
    });
    expect(authStateStorage.read()).toMatchObject({
      clientId: "public-client",
      registrationFingerprint: '{"client_name":"Public client"}',
    });
    expect(authStateStorage.read()).not.toHaveProperty("clientAuthMethod");
    expect(authStateStorage.read()).not.toHaveProperty("clientAuthKeyPair");

    const publicState = await auth.loadState();
    if (!publicState) throw new Error("Public registration state is missing");
    await auth.saveState({
      ...publicState,
      accessToken: "expired-public-token",
      expiresAt: Date.now() - 5000,
      refreshToken: "public-refresh-token",
    });
    await expect(auth.getAccessToken()).resolves.toBe("refreshed-public-token");
    const refreshRequest = fetchSpy.mock.calls[3]?.[1] as RequestInit;
    const body = new URLSearchParams(refreshRequest.body as string);
    expect(body.get("client_id")).toBe("public-client");
    expect(body.has("client_assertion")).toBe(false);
    expect(new Headers(refreshRequest.headers).has("Authorization")).toBe(
      false
    );
  });

  it("clears stored tokens when refresh_token is invalid", async () => {
    const authStateStorage = createMemoryAuthStateStorage({
      accessToken: "expired-access-token",
      clientId: "client-123",
      expiresAt: Date.now() - 5000,
      refreshToken: "stale-refresh-token",
    });
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_endpoint: "https://issuer.example/oauth/authorize",
            issuer: "https://issuer.example",
            token_endpoint: "https://issuer.example/oauth/token",
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));

    let refreshError: unknown;
    try {
      await auth.getAccessToken();
    } catch (error) {
      refreshError = error;
    }

    expect(refreshError).toBeInstanceOf(TokenRefreshError);
    expect(refreshError).toMatchObject({
      code: "token_refresh_failed",
      name: "TokenRefreshError",
      responseBody: "invalid_grant",
      status: 400,
    });
    await expect(auth.getAccessToken()).rejects.toThrow(TokenExpiredError);
    expect(authStateStorage.read()).toEqual({
      clientId: "client-123",
      dpopKeyPair: TEST_KEY_PAIR,
    });
  });
});

describe("detectStepUp", () => {
  it("throws a step-up error for insufficient_authorization responses", () => {
    expect(() =>
      detectStepUp(
        403,
        JSON.stringify({
          acr_values: "urn:zentity:acr:tier2",
          auth_session: "auth-session-1",
          error: "insufficient_authorization",
        })
      )
    ).toThrow(StepUpRequiredError);
  });

  it("ignores unrelated responses", () => {
    expect(() =>
      detectStepUp(
        403,
        JSON.stringify({
          error: "invalid_grant",
        })
      )
    ).not.toThrow();
  });
});
