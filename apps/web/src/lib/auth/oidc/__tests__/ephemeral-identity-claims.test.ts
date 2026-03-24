import { beforeEach, describe, expect, it, vi } from "vitest";

// Track used JTIs in memory for test isolation
const usedJtis = new Map<
  string,
  { jti: string; userId: string; expiresAt: number }
>();

const { mockLogInfo } = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
  logger: {
    child: () => ({ info: mockLogInfo, warn: vi.fn() }),
  },
}));

vi.mock("@/lib/db/connection", () => ({
  db: {
    delete: () => ({
      where: () => ({ run: vi.fn() }),
      run: vi.fn().mockImplementation(() => {
        usedJtis.clear();
      }),
    }),
    select: () => ({
      from: () => ({
        where: (_condition: unknown) => ({
          limit: () => ({
            get: vi.fn().mockImplementation(() => {
              for (const row of usedJtis.values()) {
                return row;
              }
              return undefined;
            }),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          run: vi.fn(),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema/crypto", () => ({
  usedIntentJtis: {
    jti: "jti",
    expiresAt: "expiresAt",
  },
}));

import {
  clearEphemeralClaims,
  resolveEphemeralClaims,
  storeEphemeralClaims,
} from "../ephemeral-identity-claims";

function resetEphemeralStore() {
  const key = Symbol.for("zentity.ephemeral-identity-claims");
  const g = globalThis as Record<symbol, Map<string, unknown> | undefined>;
  g[key]?.clear();
}

import { createScopeHash } from "../identity-intent";

function makeMeta(intentJti: string, scopes: string[]) {
  return {
    clientId: "client-1",
    scopeHash: createScopeHash(scopes),
    intentJti,
  };
}

describe("ephemeral identity claims store", () => {
  beforeEach(() => {
    vi.useRealTimers();
    usedJtis.clear();
    resetEphemeralStore();
    mockLogInfo.mockClear();
  });

  it("stores and consumes claims by userId:clientId:flowTag", async () => {
    const scopes = ["openid", "identity.name"];

    const storeResult = await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada", family_name: "Lovelace" },
      scopes,
      makeMeta("intent-1", scopes),
      "oauth"
    );

    expect(storeResult).toEqual({ ok: true });

    // resolveEphemeralClaims with no jti falls through to "oauth"
    const consumed = resolveEphemeralClaims("user-1", "client-1");
    expect(consumed?.claims).toEqual({
      given_name: "Ada",
      family_name: "Lovelace",
    });
    expect(consumed?.meta.intentJti).toBe("intent-1");
    expect(resolveEphemeralClaims("user-1", "client-1")).toBeNull();
  });

  it("isolates claims by clientId — different clients don't cross-consume", async () => {
    const scopes = ["openid", "identity.name"];

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        {
          clientId: "client-A",
          scopeHash: createScopeHash(scopes),
          intentJti: "intent-a",
        },
        "oauth"
      )
    ).toEqual({ ok: true });

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        {
          clientId: "client-B",
          scopeHash: createScopeHash(scopes),
          intentJti: "intent-b",
        },
        "oauth"
      )
    ).toEqual({ ok: true });

    const a = resolveEphemeralClaims("user-1", "client-A");
    expect(a?.claims.given_name).toBe("Ada");

    const b = resolveEphemeralClaims("user-1", "client-B");
    expect(b?.claims.given_name).toBe("Grace");
  });

  it("allows concurrent stages for same user:client with different flow tags", async () => {
    const scopes = ["openid", "identity.name"];

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        makeMeta("intent-oauth", scopes),
        "oauth"
      )
    ).toEqual({ ok: true });

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-ciba", scopes),
        "ciba:req-123"
      )
    ).toEqual({ ok: true });

    // Both exist independently — resolve each via its flow path
    const oauth = resolveEphemeralClaims("user-1", "client-1");
    expect(oauth?.claims.given_name).toBe("Ada");

    const ciba = resolveEphemeralClaims("user-1", "client-1", "req-123");
    expect(ciba?.claims.given_name).toBe("Grace");
  });

  it("rejects duplicate stage for the same exact key (same flow tag)", async () => {
    const scopes = ["openid", "identity.name"];

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        makeMeta("intent-3", scopes),
        "oauth"
      )
    ).toEqual({ ok: true });

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-4", scopes),
        "oauth"
      )
    ).toEqual({ ok: false, reason: "concurrent_stage" });

    // Original entry is preserved
    const consumed = resolveEphemeralClaims("user-1", "client-1");
    expect(consumed?.claims.given_name).toBe("Ada");
  });

  it("still rejects replacement after the old lock window until expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const scopes = ["openid", "identity.name"];

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        makeMeta("intent-stale-1", scopes),
        "oauth"
      )
    ).toEqual({ ok: true });

    vi.advanceTimersByTime(2 * 60 * 1000 + 1);

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-stale-2", scopes),
        "oauth"
      )
    ).toEqual({ ok: false, reason: "concurrent_stage" });

    const consumed = resolveEphemeralClaims("user-1", "client-1");
    expect(consumed?.claims.given_name).toBe("Ada");
  });

  it("clearEphemeralClaims removes a staged entry", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-clear", scopes),
      "oauth"
    );

    expect(clearEphemeralClaims("user-1", "client-1", "oauth")).toBe(true);
    expect(resolveEphemeralClaims("user-1", "client-1")).toBeNull();
    expect(clearEphemeralClaims("user-1", "client-1", "oauth")).toBe(false);
  });

  it("evicts expired entries and allows fresh stage flow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const scopes = ["openid", "identity.name"];
    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        makeMeta("intent-exp", scopes),
        "oauth"
      )
    ).toEqual({ ok: true });

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(resolveEphemeralClaims("user-1", "client-1")).toBeNull();

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-exp-2", scopes),
        "oauth"
      )
    ).toEqual({ ok: true });
  });

  it("clearEphemeralClaims lifecycle: store → clear → re-store succeeds", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "test-user",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-lc-1", scopes),
      "oauth"
    );

    clearEphemeralClaims("test-user", "client-1", "oauth");

    const reStoreResult = await storeEphemeralClaims(
      "test-user",
      { given_name: "Grace" },
      scopes,
      makeMeta("intent-lc-2", scopes),
      "oauth"
    );
    expect(reStoreResult).toEqual({ ok: true });

    const consumed = resolveEphemeralClaims("test-user", "client-1");
    expect(consumed?.claims).toEqual({ given_name: "Grace" });
    expect(consumed?.meta.intentJti).toBe("intent-lc-2");
  });

  it("store → clear → consume returns null (entry was cleared, not consumed)", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "test-user",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-clr", scopes),
      "oauth"
    );

    clearEphemeralClaims("test-user", "client-1", "oauth");

    expect(resolveEphemeralClaims("test-user", "client-1")).toBeNull();
  });
});

describe("resolveEphemeralClaims (two-key resolution)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    usedJtis.clear();
    resetEphemeralStore();
    mockLogInfo.mockClear();
  });

  it("resolves CIBA token via ciba:{jti} key when jti is present", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-ciba-resolve", scopes),
      "ciba:req-abc"
    );

    const result = resolveEphemeralClaims("user-1", "client-1", "req-abc");
    expect(result?.claims.given_name).toBe("Ada");

    // Second resolve returns null (single-consume)
    expect(resolveEphemeralClaims("user-1", "client-1", "req-abc")).toBeNull();
  });

  it("resolves OAuth token via oauth key when no jti", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "user-1",
      { given_name: "Grace" },
      scopes,
      makeMeta("intent-oauth-resolve", scopes),
      "oauth"
    );

    const result = resolveEphemeralClaims("user-1", "client-1");
    expect(result?.claims.given_name).toBe("Grace");
  });

  it("falls through from ciba to oauth when ciba key is absent", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "user-1",
      { given_name: "Grace" },
      scopes,
      makeMeta("intent-fallthrough", scopes),
      "oauth"
    );

    // jti provided but no ciba entry → falls through to oauth
    const result = resolveEphemeralClaims("user-1", "client-1", "other-jti");
    expect(result?.claims.given_name).toBe("Grace");
  });

  it("prefers ciba entry when both oauth and ciba are staged", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "user-1",
      { given_name: "OAuth Ada" },
      scopes,
      makeMeta("intent-dual-oauth", scopes),
      "oauth"
    );

    await storeEphemeralClaims(
      "user-1",
      { given_name: "CIBA Grace" },
      scopes,
      makeMeta("intent-dual-ciba", scopes),
      "ciba:req-xyz"
    );

    // With matching jti → picks CIBA
    const ciba = resolveEphemeralClaims("user-1", "client-1", "req-xyz");
    expect(ciba?.claims.given_name).toBe("CIBA Grace");

    // OAuth is still intact
    const oauth = resolveEphemeralClaims("user-1", "client-1");
    expect(oauth?.claims.given_name).toBe("OAuth Ada");
  });

  it("returns null when no entries exist", () => {
    expect(resolveEphemeralClaims("user-1", "client-1")).toBeNull();
    expect(resolveEphemeralClaims("user-1", "client-1", "jti-x")).toBeNull();
  });
});

describe("identity-release observability", () => {
  beforeEach(() => {
    vi.useRealTimers();
    usedJtis.clear();
    resetEphemeralStore();
    mockLogInfo.mockClear();
  });

  it("logs stage_success with metadata and no PII", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada", family_name: "Lovelace" },
      scopes,
      makeMeta("intent-log-1", scopes),
      "oauth"
    );

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "stage_success",
        userId: "user-1",
        clientId: "client-1",
        flowTag: "oauth",
        intentJti: "intent-log-1",
        ttlMs: 5 * 60 * 1000,
      }),
      "identity release staged"
    );

    // No PII in the log call
    const logArg = mockLogInfo.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logArg).not.toHaveProperty("given_name");
    expect(logArg).not.toHaveProperty("family_name");
    expect(JSON.stringify(logArg)).not.toContain("Ada");
    expect(JSON.stringify(logArg)).not.toContain("Lovelace");
  });

  it("logs consume_success with ciba_direct resolution", async () => {
    const scopes = ["openid", "identity.name"];
    await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-ciba-log", scopes),
      "ciba:req-abc"
    );
    mockLogInfo.mockClear();

    resolveEphemeralClaims("user-1", "client-1", "req-abc");

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "consume_success",
        userId: "user-1",
        clientId: "client-1",
        resolvedFlowTag: "ciba:req-abc",
        resolution: "ciba_direct",
      }),
      "identity release consumed"
    );
  });

  it("logs consume_success with oauth_direct resolution (no jti)", async () => {
    const scopes = ["openid", "identity.name"];
    await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-oauth-log", scopes),
      "oauth"
    );
    mockLogInfo.mockClear();

    resolveEphemeralClaims("user-1", "client-1");

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "consume_success",
        resolvedFlowTag: "oauth",
        resolution: "oauth_direct",
        found: true,
      }),
      "identity release consumed"
    );
  });

  it("logs consume_miss with ciba_miss_oauth_fallback when both fail", () => {
    resolveEphemeralClaims("user-1", "client-1", "nonexistent-jti");

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "consume_miss",
        userId: "user-1",
        clientId: "client-1",
        resolvedFlowTag: undefined,
        resolution: "ciba_miss_oauth_fallback",
        found: false,
        cibaJtiAttempted: "nonexistent-jti",
      }),
      "identity release not found"
    );
  });

  it("logs consume_success with ciba_miss_oauth_fallback when ciba misses but oauth resolves", async () => {
    const scopes = ["openid", "identity.name"];
    await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-fallback-log", scopes),
      "oauth"
    );
    mockLogInfo.mockClear();

    resolveEphemeralClaims("user-1", "client-1", "wrong-jti");

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "consume_success",
        resolution: "ciba_miss_oauth_fallback",
        found: true,
        cibaJtiAttempted: "wrong-jti",
      }),
      "identity release consumed"
    );
  });
});
