// @vitest-environment node

import { runWithRequestState } from "@better-auth/core/context";
import { createClient } from "@libsql/client";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "./auth";
import { user } from "./db/schema";

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
  readDcrClient: vi.fn(),
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
  readDcrClient: authMocks.readDcrClient,
}));

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

type ProviderConfig = GenericOAuthConfig & {
  getUserInfo: NonNullable<GenericOAuthConfig["getUserInfo"]>;
  mapProfileToUser: NonNullable<GenericOAuthConfig["mapProfileToUser"]>;
};
type AuthConfig = Pick<Auth["options"], "databaseHooks" | "user"> & {
  plugins: { type: string; config?: ProviderConfig[] }[];
};

async function loadAuthConfig() {
  const { getAuth } = await import("./auth");
  return (await getAuth()) as unknown as AuthConfig;
}

function findProvider(auth: AuthConfig, id: string) {
  const plugin = auth.plugins.find((entry) => entry.type === "genericOAuth");
  const provider = plugin?.config?.find((entry) => entry.providerId === id);
  if (!provider) {
    throw new Error(`Missing test provider ${id}`);
  }
  return provider;
}

async function loadProviderConfig() {
  return findProvider(await loadAuthConfig(), "zentity-x402");
}

describe("getAuth provider discovery", () => {
  beforeEach(() => {
    vi.resetModules();
    authMocks.readDcrClient.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
  });

  it("discovers Zentity through the OIDC discovery URL of its issuer", async () => {
    const provider = await loadProviderConfig();

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
    authMocks.readDcrClient.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    authMocks.fetchUserInfo.mockResolvedValue({
      email: "alice@example.com",
      sub: "pairwise-sub",
    });
    authMocks.verifyToken.mockResolvedValue({
      payload: { sub: "pairwise-sub" },
    });
    authMocks.getDb.mockReturnValue({});
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
    const provider = await loadProviderConfig();

    expect(provider.postLogoutRedirectURI).toBe("http://localhost:3102/x402");
  });

  it("rebuilds provider configuration from the latest DCR client id", async () => {
    authMocks.readDcrClient.mockResolvedValue({
      clientId: "client-before",
      clientSecret: "secret-before",
    });
    const first = await loadProviderConfig();
    authMocks.readDcrClient.mockResolvedValue({
      clientId: "client-after",
      clientSecret: "secret-after",
    });
    const second = await loadProviderConfig();

    expect(first.clientId).toBe("client-before");
    expect(second.clientId).toBe("client-after");
    expect(first.clientSecret).toBe("secret-before");
    expect(first.tokenEndpointAuth).toEqual({ method: "client_secret_basic" });
  });
});

describe("linked scenario claims", () => {
  const bank = {
    userId: "alice",
    providerId: "zentity-bank",
    accountId: "bank-sub",
  };
  const exchange = {
    userId: "alice",
    providerId: "zentity-exchange",
    accountId: "exchange-sub",
  };
  let config: AuthConfig;
  let db: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    db = drizzle(createClient({ url: ":memory:" }));
    const empty = await generateSQLiteDrizzleJson({});
    const tables = await generateSQLiteDrizzleJson({ user });
    await db.$client.batch(await generateSQLiteMigration(empty, tables));
    await db.insert(user).values([
      { id: "alice", name: "Alice", email: "alice@example.test" },
      { id: "bob", name: "Bob", email: "bob@example.test", claims: "null" },
    ]);
    authMocks.getDb.mockReturnValue(db);
    authMocks.readDcrClient.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    config = await loadAuthConfig();
  });

  afterEach(() => db.$client.close());

  async function callback(
    event: "create" | "update",
    account: typeof bank,
    fields: Record<string, unknown>,
    source = account
  ) {
    await runWithRequestState(new WeakMap(), async () => {
      await findProvider(config, source.providerId).mapProfileToUser({
        id: source.accountId,
        sub: source.accountId,
        emailVerified: true,
        ...fields,
      });
      await config.databaseHooks.account[event].after(account);
    });
  }

  async function savedClaims(userId: string) {
    const row = await db
      .select({ claims: user.claims })
      .from(user)
      .where(eq(user.id, userId))
      .get();
    return JSON.parse(row?.claims ?? "{}");
  }

  it("keeps concurrent callbacks for one user, including partial disclosures from the same provider", async () => {
    await callback("create", bank, { address: { old: true }, name: "old" });
    await Promise.all([
      callback("update", bank, { address: { current: true }, name: null }),
      callback("update", bank, { verified: true }),
      callback("create", exchange, { nationality: "US" }),
    ]);
    expect(await savedClaims("alice")).toEqual({
      [bank.providerId]: {
        id: bank.accountId,
        sub: bank.accountId,
        emailVerified: true,
        address: { current: true },
        name: null,
        verified: true,
      },
      [exchange.providerId]: {
        id: exchange.accountId,
        sub: exchange.accountId,
        emailVerified: true,
        nationality: "US",
      },
    });
  });

  it("uses the linked owner and requires both provider and subject to match", async () => {
    const bob = { ...exchange, userId: "bob", accountId: bank.accountId };
    await callback("create", bank, { name: "Alice" });
    await callback("create", bob, { nationality: "US" });
    await callback("update", bob, { unexpected: true }, bank);
    await callback("update", bob, { unexpected: true }, exchange);

    expect(await savedClaims("alice")).toEqual({
      [bank.providerId]: expect.objectContaining({ name: "Alice" }),
    });
    expect(await savedClaims("bob")).toEqual({
      [bob.providerId]: {
        id: bob.accountId,
        sub: bob.accountId,
        emailVerified: true,
        nationality: "US",
      },
    });
  });

  it("starts a new profile when a different subject uses the same provider", async () => {
    await callback("create", bank, { name: "first account" });
    const second = { ...bank, accountId: "another-bank-sub" };
    await callback("create", second, { verified: true });
    expect((await savedClaims("alice"))[bank.providerId]).toEqual({
      id: second.accountId,
      sub: second.accountId,
      emailVerified: true,
      verified: true,
    });
  });

  it("keeps provider claims read-only for clients", () => {
    expect(config.user.additionalFields.claims.input).toBe(false);
  });
});
