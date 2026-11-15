import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  betterAuth: vi.fn((config) => config),
  createOpenIdTokenVerifier: vi.fn(),
  decodeProtectedHeader: vi.fn(),
  dpopClient: { keyPair: {} },
  dpopKeyPair: { privateKey: {}, publicKey: {} },
  drizzleAdapter: vi.fn(() => ({ adapter: true })),
  fetchUserInfo: vi.fn(),
  genericOAuth: vi.fn((config) => ({ type: "genericOAuth", ...config })),
  getDb: vi.fn(() => ({})),
  nextCookies: vi.fn(() => ({ type: "nextCookies" })),
  readDcrClientId: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("@better-auth/drizzle-adapter", () => ({
  drizzleAdapter: authMocks.drizzleAdapter,
}));

vi.mock("better-auth", () => ({
  betterAuth: authMocks.betterAuth,
}));

vi.mock("better-auth/next-js", () => ({
  nextCookies: authMocks.nextCookies,
}));

vi.mock("better-auth/plugins", () => ({
  genericOAuth: authMocks.genericOAuth,
}));

vi.mock("@zentity/sdk/rp", () => ({
  createOpenIdTokenVerifier: authMocks.createOpenIdTokenVerifier,
  fetchUserInfo: authMocks.fetchUserInfo,
}));

vi.mock("jose", () => ({
  decodeProtectedHeader: authMocks.decodeProtectedHeader,
}));

vi.mock("@/lib/db/connection", () => ({
  getDb: authMocks.getDb,
}));

vi.mock("@/lib/dcr", () => ({
  readDcrClientId: authMocks.readDcrClientId,
}));

vi.mock("@/scenarios/route-scenario-registry", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/scenarios/route-scenario-registry")
    >();
  return { ...actual, ROUTE_SCENARIO_IDS: ["x402"] };
});

vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_SECRET: "test-secret",
    NEXT_PUBLIC_APP_URL: "http://localhost:3102",
    ZENTITY_URL: "http://zentity.example",
  },
}));

vi.mock("@/lib/oauth-dpop-client", () => ({
  getOAuthDpopClient: async () => authMocks.dpopClient,
  getOAuthDpopKeyPair: async () => authMocks.dpopKeyPair,
}));

vi.mock("server-only", () => ({}));

async function loadProviderConfig() {
  const { getAuth } = await import("./auth");
  const auth = await getAuth();
  const plugins = (auth as unknown as { plugins: Record<string, unknown>[] })
    .plugins;
  const oauthPlugin = plugins.find((plugin) => plugin.type === "genericOAuth");
  if (!oauthPlugin) {
    throw new Error("genericOAuth plugin not configured");
  }

  const config = oauthPlugin.config as Record<string, unknown>[];
  const provider = config.find(
    (entry) => entry.providerId === "zentity-x402"
  ) as
    | {
        getUserInfo(tokens: {
          accessToken?: string;
          idToken?: string;
        }): Promise<unknown>;
      }
    | undefined;

  if (!provider) {
    throw new Error("x402 provider not configured");
  }

  return provider;
}

describe("getAuth provider discovery", () => {
  beforeEach(() => {
    vi.resetModules();
    authMocks.readDcrClientId.mockResolvedValue("test-client");
  });

  it("discovers Zentity through the OIDC discovery URL of its issuer", async () => {
    const provider = (await loadProviderConfig()) as unknown as {
      discoveryUrl: string;
    };

    // OpenID Connect Discovery 1.0 §4 appends the well-known path to the
    // issuer, so this URL names `http://zentity.example/api/auth`.
    expect(provider.discoveryUrl).toBe(
      "http://zentity.example/api/auth/.well-known/openid-configuration"
    );
  });
});

describe("getAuth provider userinfo", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMocks.createOpenIdTokenVerifier.mockReturnValue({
      verify: authMocks.verifyToken,
    });
    authMocks.readDcrClientId.mockResolvedValue("test-client");
    authMocks.fetchUserInfo.mockResolvedValue({
      email: "alice@example.com",
      sub: "pairwise-sub",
    });
    authMocks.verifyToken.mockResolvedValue({
      payload: { sub: "pairwise-sub" },
    });
    authMocks.getDb.mockReturnValue({
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(),
        })),
      })),
      query: {
        account: { findFirst: vi.fn().mockResolvedValue(null) },
        user: { findFirst: vi.fn().mockResolvedValue(null) },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(),
        })),
      })),
    });
  });

  it("rejects when userinfo succeeds but id_token verification fails", async () => {
    authMocks.verifyToken.mockRejectedValueOnce(new Error("bad_id_token"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          email: "alice@example.com",
          sub: "pairwise-sub",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );

    const provider = await loadProviderConfig();

    await expect(
      provider.getUserInfo({
        accessToken: "access-token",
        idToken: "bad-id-token",
      })
    ).rejects.toThrow("bad_id_token");
  });

  it("rejects when the id_token at_hash does not match the access token", async () => {
    authMocks.verifyToken.mockResolvedValueOnce({
      payload: {
        at_hash: "wrong-hash",
        sub: "pairwise-sub",
      },
    });
    authMocks.decodeProtectedHeader.mockReturnValue({ alg: "RS256" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          email: "alice@example.com",
          sub: "pairwise-sub",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );

    const provider = await loadProviderConfig();

    await expect(
      provider.getUserInfo({
        accessToken: "access-token",
        idToken: "good-id-token",
      })
    ).rejects.toThrow("ID token at_hash mismatch");
  });

  it("returns no profile when the userinfo request fails", async () => {
    authMocks.fetchUserInfo.mockResolvedValueOnce(null);

    const provider = await loadProviderConfig();

    await expect(
      provider.getUserInfo({
        accessToken: "access-token",
        idToken: "id-token",
      })
    ).resolves.toBeNull();
    expect(authMocks.verifyToken).not.toHaveBeenCalled();
  });

  it("configures id_token verification against the Zentity issuer", async () => {
    const provider = await loadProviderConfig();

    await provider.getUserInfo({ idToken: "id-token" });

    expect(authMocks.createOpenIdTokenVerifier).toHaveBeenCalledWith({
      issuerUrl: "http://zentity.example",
    });
    expect(authMocks.verifyToken).toHaveBeenCalledWith("id-token");
  });

  it("presents userinfo with the shared sign-in DPoP client", async () => {
    const provider = await loadProviderConfig();

    await provider.getUserInfo({ accessToken: "access-token" });

    expect(authMocks.fetchUserInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token",
        dpopClient: authMocks.dpopClient,
      })
    );
  });

  it("lets generic OAuth sign the token requests with one DPoP key", async () => {
    const { getAuth } = await import("./auth");
    const configs = await Promise.all(
      [getAuth(), getAuth()].map(async (pending) => {
        const auth = (await pending) as unknown as {
          plugins: Record<string, unknown>[];
        };
        const plugin = auth.plugins.find(
          (entry) => entry.type === "genericOAuth"
        ) as { config: Record<string, unknown>[] };
        return plugin.config;
      })
    );

    const providers = configs.flat();
    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) {
      expect(provider.getToken).toBeUndefined();
      expect(provider.pushedAuthorizationRequest).toBe("auto");
      expect((provider.dpop as { keyPair: unknown }).keyPair).toBe(
        authMocks.dpopKeyPair
      );
    }
  });

  it("returns to the scenario after provider logout", async () => {
    const provider = (await loadProviderConfig()) as Record<string, unknown>;

    expect(provider.postLogoutRedirectURI).toBe("http://localhost:3102/x402");
  });

  it("rebuilds provider configuration from the latest DCR client id", async () => {
    authMocks.readDcrClientId
      .mockResolvedValueOnce("client-before")
      .mockResolvedValueOnce("client-after");

    const { getAuth } = await import("./auth");
    const firstAuth = await getAuth();
    const secondAuth = await getAuth();

    const firstProvider = (
      firstAuth as unknown as { plugins: Record<string, unknown>[] }
    ).plugins.find((plugin) => plugin.type === "genericOAuth") as
      | { config: Record<string, unknown>[] }
      | undefined;
    const secondProvider = (
      secondAuth as unknown as { plugins: Record<string, unknown>[] }
    ).plugins.find((plugin) => plugin.type === "genericOAuth") as
      | { config: Record<string, unknown>[] }
      | undefined;

    expect(firstProvider?.config[0]?.clientId).toBe("client-before");
    expect(secondProvider?.config[0]?.clientId).toBe("client-after");
  });
});
