import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  betterAuth: vi.fn((config) => config),
  createOpenIdTokenVerifier: vi.fn(),
  createDpopClient: vi.fn(),
  decodeProtectedHeader: vi.fn(),
  drizzleAdapter: vi.fn(() => ({ adapter: true })),
  fetchUserInfo: vi.fn(),
  genericOAuth: vi.fn((config) => ({ type: "genericOAuth", ...config })),
  getDb: vi.fn(() => ({})),
  nextCookies: vi.fn(() => ({ type: "nextCookies" })),
  parseOAuthJsonResponse: vi.fn((response: Response) => response.json()),
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
  createDpopClient: authMocks.createDpopClient,
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

vi.mock("@/lib/oauth-response", () => ({
  describeOAuthErrorResponse: vi.fn(() => "oauth_error"),
  parseOAuthJsonResponse: authMocks.parseOAuthJsonResponse,
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

  it("configures id_token verification against the Zentity issuer", async () => {
    const provider = await loadProviderConfig();

    await provider.getUserInfo({ idToken: "id-token" });

    expect(authMocks.createOpenIdTokenVerifier).toHaveBeenCalledWith({
      issuerUrl: "http://zentity.example",
    });
    expect(authMocks.verifyToken).toHaveBeenCalledWith("id-token");
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
