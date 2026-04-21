import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  betterAuth: vi.fn((config) => config),
  currentClientIdKey: vi.fn(),
  createDpopClient: vi.fn(),
  createRemoteJWKSet: vi.fn(() => "jwks"),
  decodeProtectedHeader: vi.fn(),
  drizzleAdapter: vi.fn(() => ({ adapter: true })),
  genericOAuth: vi.fn((config) => ({ type: "genericOAuth", ...config })),
  getDb: vi.fn(() => ({})),
  jwtVerify: vi.fn(),
  nextCookies: vi.fn(() => ({ type: "nextCookies" })),
  parseOAuthJsonResponse: vi.fn((response: Response) => response.json()),
  readDcrClientId: vi.fn(),
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

vi.mock("jose", () => ({
  createRemoteJWKSet: authMocks.createRemoteJWKSet,
  decodeProtectedHeader: authMocks.decodeProtectedHeader,
  jwtVerify: authMocks.jwtVerify,
}));

vi.mock("@/lib/db/connection", () => ({
  getDb: authMocks.getDb,
}));

vi.mock("@/lib/dcr", () => ({
  PROVIDER_IDS: ["x402"],
  currentClientIdKey: authMocks.currentClientIdKey,
  readDcrClientId: authMocks.readDcrClientId,
}));

vi.mock("@/lib/dpop", () => ({
  createDpopClient: authMocks.createDpopClient,
}));

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
  const plugins = (auth as unknown as { plugins: Array<Record<string, unknown>> })
    .plugins;
  const oauthPlugin = plugins.find((plugin) => plugin.type === "genericOAuth");
  if (!oauthPlugin) {
    throw new Error("genericOAuth plugin not configured");
  }

  const config = oauthPlugin.config as Array<Record<string, unknown>>;
  const provider = config.find(
    (entry) => entry.providerId === "zentity-x402",
  ) as { getUserInfo(tokens: { accessToken?: string; idToken?: string }): Promise<unknown> } | undefined;

  if (!provider) {
    throw new Error("x402 provider not configured");
  }

  return provider;
}

describe("getAuth provider userinfo", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMocks.createRemoteJWKSet.mockReturnValue("jwks");
    authMocks.currentClientIdKey.mockResolvedValue("x402=test-client");
    authMocks.readDcrClientId.mockResolvedValue("test-client");
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
    authMocks.jwtVerify.mockRejectedValueOnce(new Error("bad_id_token"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          email: "alice@example.com",
          sub: "pairwise-sub",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const provider = await loadProviderConfig();

    await expect(
      provider.getUserInfo({
        accessToken: "access-token",
        idToken: "bad-id-token",
      }),
    ).rejects.toThrow("bad_id_token");
  });

  it("rejects when the id_token at_hash does not match the access token", async () => {
    authMocks.jwtVerify.mockResolvedValueOnce({
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
        },
      ),
    );

    const provider = await loadProviderConfig();

    await expect(
      provider.getUserInfo({
        accessToken: "access-token",
        idToken: "good-id-token",
      }),
    ).rejects.toThrow("ID token at_hash mismatch");
  });

  it("refreshes the JWKS after the cache TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    authMocks.jwtVerify.mockResolvedValue({
      payload: { sub: "pairwise-sub" },
    });

    try {
      const provider = await loadProviderConfig();

      await provider.getUserInfo({ idToken: "first-id-token" });
      vi.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));
      await provider.getUserInfo({ idToken: "second-id-token" });

      expect(authMocks.createRemoteJWKSet).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
