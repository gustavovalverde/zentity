import { beforeEach, describe, expect, it, vi } from "vitest";

// Track used JTIs in memory for test isolation
const usedJtis = new Map<
  string,
  { jti: string; userId: string; expiresAt: number }
>();

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
              // Extract the JTI from the condition — simplistic mock
              for (const row of usedJtis.values()) {
                // Return the first matching row (real test uses exact equality)
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

// Override the DB functions to use our in-memory Map for realistic behavior
vi.mock("../ephemeral-identity-claims", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../ephemeral-identity-claims")>();

  // We need to intercept at a higher level. Instead, let's just re-implement
  // the DB interaction with in-memory logic for tests.
  return original;
});

import {
  clearEphemeralClaims,
  consumeEphemeralClaims,
  consumeEphemeralClaimsByUser,
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
  });

  it("stores and consumes claims by userId:clientId", async () => {
    const scopes = ["openid", "identity.name"];

    const storeResult = await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada", family_name: "Lovelace" },
      scopes,
      makeMeta("intent-1", scopes)
    );

    expect(storeResult).toEqual({ ok: true });

    const consumed = consumeEphemeralClaims("user-1", "client-1");
    expect(consumed?.claims).toEqual({
      given_name: "Ada",
      family_name: "Lovelace",
    });
    expect(consumed?.meta.intentJti).toBe("intent-1");
    expect(consumeEphemeralClaims("user-1", "client-1")).toBeNull();
  });

  it("isolates claims by clientId — different clients don't cross-consume", async () => {
    const scopes = ["openid", "identity.name"];

    expect(
      await storeEphemeralClaims("user-1", { given_name: "Ada" }, scopes, {
        clientId: "client-A",
        scopeHash: createScopeHash(scopes),
        intentJti: "intent-a",
      })
    ).toEqual({ ok: true });

    expect(
      await storeEphemeralClaims("user-1", { given_name: "Grace" }, scopes, {
        clientId: "client-B",
        scopeHash: createScopeHash(scopes),
        intentJti: "intent-b",
      })
    ).toEqual({ ok: true });

    // Client A gets Ada, Client B gets Grace
    const a = consumeEphemeralClaims("user-1", "client-A");
    expect(a?.claims.given_name).toBe("Ada");

    const b = consumeEphemeralClaims("user-1", "client-B");
    expect(b?.claims.given_name).toBe("Grace");
  });

  it("consumeByUser returns null when multiple clients have staged entries", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims("user-1", { given_name: "Ada" }, scopes, {
      clientId: "client-A",
      scopeHash: createScopeHash(scopes),
      intentJti: "intent-x",
    });
    await storeEphemeralClaims("user-1", { given_name: "Grace" }, scopes, {
      clientId: "client-B",
      scopeHash: createScopeHash(scopes),
      intentJti: "intent-y",
    });

    // Ambiguous — returns null to prevent cross-client leakage
    expect(consumeEphemeralClaimsByUser("user-1")).toBeNull();
  });

  it("consumeByUser returns entry when only one client has staged", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-single", scopes)
    );

    const result = consumeEphemeralClaimsByUser("user-1");
    expect(result?.claims.given_name).toBe("Ada");
    expect(consumeEphemeralClaimsByUser("user-1")).toBeNull();
  });

  it("rejects concurrent same-client stage attempts while an entry is live", async () => {
    const scopes = ["openid", "identity.name"];

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        makeMeta("intent-3", scopes)
      )
    ).toEqual({ ok: true });

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-4", scopes)
      )
    ).toEqual({ ok: false, reason: "concurrent_stage" });

    // Original entry is preserved
    const consumed = consumeEphemeralClaims("user-1", "client-1");
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
        makeMeta("intent-stale-1", scopes)
      )
    ).toEqual({ ok: true });

    // Advance past the previous 2-minute lock window. The entry is still live,
    // so the replacement must still be rejected until consumption or expiry.
    vi.advanceTimersByTime(2 * 60 * 1000 + 1);

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-stale-2", scopes)
      )
    ).toEqual({ ok: false, reason: "concurrent_stage" });

    const consumed = consumeEphemeralClaims("user-1", "client-1");
    expect(consumed?.claims.given_name).toBe("Ada");
  });

  it("clearEphemeralClaims removes a staged entry", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-clear", scopes)
    );

    expect(clearEphemeralClaims("user-1", "client-1")).toBe(true);
    expect(consumeEphemeralClaims("user-1", "client-1")).toBeNull();
    expect(clearEphemeralClaims("user-1", "client-1")).toBe(false);
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
        makeMeta("intent-exp", scopes)
      )
    ).toEqual({ ok: true });

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(consumeEphemeralClaims("user-1", "client-1")).toBeNull();

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-exp-2", scopes)
      )
    ).toEqual({ ok: true });
  });

  it("clearEphemeralClaims lifecycle: store → clear → re-store succeeds", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "test-user",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-lc-1", scopes)
    );

    clearEphemeralClaims("test-user", "client-1");

    const reStoreResult = await storeEphemeralClaims(
      "test-user",
      { given_name: "Grace" },
      scopes,
      makeMeta("intent-lc-2", scopes)
    );
    expect(reStoreResult).toEqual({ ok: true });

    const consumed = consumeEphemeralClaims("test-user", "client-1");
    expect(consumed?.claims).toEqual({ given_name: "Grace" });
    expect(consumed?.meta.intentJti).toBe("intent-lc-2");
  });

  it("store → clear → consume returns null (entry was cleared, not consumed)", async () => {
    const scopes = ["openid", "identity.name"];

    await storeEphemeralClaims(
      "test-user",
      { given_name: "Ada" },
      scopes,
      makeMeta("intent-clr", scopes)
    );

    clearEphemeralClaims("test-user", "client-1");

    expect(consumeEphemeralClaims("test-user", "client-1")).toBeNull();
  });
});
