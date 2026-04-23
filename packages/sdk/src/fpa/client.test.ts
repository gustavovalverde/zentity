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
  async withNonceRetry<T>(
    attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
  ) {
    return attempt();
  },
} satisfies DpopClient;

const fpaMocks = vi.hoisted(() => ({
  createDpopClientFromKeyPair: vi.fn(async () => mockDpopClient),
  ensureOpaqueReady: vi.fn(async () => undefined),
  exchangeAuthorizationCode: vi.fn(),
  exchangeToken: vi.fn(),
  finishOpaqueLogin: vi.fn(),
  generateDpopKeyPair: vi.fn(async () => TEST_KEY_PAIR),
  generatePkceChallenge: vi.fn(async () => TEST_PKCE),
  startOpaqueLogin: vi.fn(),
}));

vi.mock("../rp/dpop-client", () => ({
  createDpopClientFromKeyPair: fpaMocks.createDpopClientFromKeyPair,
  generateDpopKeyPair: fpaMocks.generateDpopKeyPair,
}));

vi.mock("./opaque", () => ({
  ensureOpaqueReady: fpaMocks.ensureOpaqueReady,
  finishOpaqueLogin: fpaMocks.finishOpaqueLogin,
  startOpaqueLogin: fpaMocks.startOpaqueLogin,
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
  RedirectToWebError,
  StepUpRequiredError,
  TokenExpiredError,
  createFirstPartyAuth,
  detectStepUp,
} from "./client";

function createMemoryAuthStateStorage(
  initialState?: Record<string, unknown>
) {
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

  it("authenticates through the OPAQUE challenge flow", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });

    fpaMocks.startOpaqueLogin.mockReturnValue({
      clientLoginState: "client-state",
      startLoginRequest: "opaque-start-request",
    });
    fpaMocks.finishOpaqueLogin.mockReturnValue({
      exportKey: "export-key",
      finishLoginRequest: "opaque-finish-request",
      serverStaticPublicKey: "server-public-key",
    });
    fpaMocks.exchangeAuthorizationCode.mockResolvedValue({
      accessToken: "access-token",
      accountSub: "pairwise-subject",
      expiresAt: Date.now() + 3_600_000,
      loginHint: "user@example.com",
      refreshToken: "refresh-token",
      scopes: ["openid", "offline_access"],
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
            auth_session: "auth-session-1",
            challenge_type: "opaque",
          }),
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            opaque_login_response: "opaque-login-response",
          }),
          { status: 200 }
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
      redirectUri: "http://127.0.0.1/callback",
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
        authSession: "auth-session-1",
        exportKey: "export-key",
        loginMethod: "opaque",
      })
    );
    expect(fpaMocks.exchangeAuthorizationCode).toHaveBeenCalledWith(
      "https://issuer.example",
      expect.objectContaining({
        clientId: "client-123",
        code: "authorization-code-1",
        codeVerifier: TEST_PKCE.codeVerifier,
      })
    );
    expect(authStateStorage.read()).toEqual(
      expect.objectContaining({
        accessToken: "access-token",
        authSession: "auth-session-1",
        clientId: "client-123",
        dpopKeyPair: TEST_KEY_PAIR,
        refreshToken: "refresh-token",
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
      expiresAt: Date.now() - 5_000,
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
            auth_session: "auth-session-passkey",
            error: "redirect_to_web",
            request_uri: "urn:request:123",
          }),
          { status: 400 }
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
    ).rejects.toEqual(
      expect.objectContaining<Partial<RedirectToWebError>>({
        authSession: "auth-session-passkey",
        requestUri: "urn:request:123",
      })
    );
  });

  it("completes wallet-based authorization with an EIP-712 signature", async () => {
    const authStateStorage = createMemoryAuthStateStorage();
    const auth = createFirstPartyAuth({
      issuerUrl: "https://issuer.example",
      storage: authStateStorage.storage,
    });
    const signTypedData = vi.fn(async () => "wallet-signature");

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
            auth_session: "wallet-session-1",
            challenge_type: "eip712",
            typed_data: {
              domain: { name: "Zentity" },
              message: { action: "login" },
              primaryType: "Login",
              types: {
                EIP712Domain: [{ name: "name", type: "string" }],
                Login: [{ name: "action", type: "string" }],
              },
            },
          }),
          { status: 401 }
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
          signTypedData,
        },
      },
    });

    expect(signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: { name: "Zentity" },
      })
    );
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
      registrationFingerprint: "{\"client_name\":\"@zentity/mcp-server\"}",
      registrationMethod: "dcr",
    });
  });

  it("clears stored tokens when refresh_token is invalid", async () => {
    const authStateStorage = createMemoryAuthStateStorage({
      accessToken: "expired-access-token",
      clientId: "client-123",
      expiresAt: Date.now() - 5_000,
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
