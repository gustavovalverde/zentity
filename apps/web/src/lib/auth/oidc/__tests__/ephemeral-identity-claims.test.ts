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
  consumeEphemeralClaims,
  resetEphemeralIdentityClaimsStore,
  storeEphemeralClaims,
} from "../ephemeral-identity-claims";
import { createScopeHash } from "../identity-intent";

function makeMeta(intentJti: string, scopes: string[]) {
  return {
    clientId: "client-1",
    scopeHash: createScopeHash(scopes),
    intentJti,
  };
}

describe("ephemeral identity claims store", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    usedJtis.clear();
    await resetEphemeralIdentityClaimsStore();
  });

  it("stores and consumes claims once", async () => {
    const scopes = ["openid", "identity.name"];

    const storeResult = await storeEphemeralClaims(
      "user-1",
      { given_name: "Ada", family_name: "Lovelace" },
      scopes,
      makeMeta("intent-1", scopes)
    );

    expect(storeResult).toEqual({ ok: true });

    const consumed = consumeEphemeralClaims("user-1");
    expect(consumed?.claims).toEqual({
      given_name: "Ada",
      family_name: "Lovelace",
    });
    expect(consumed?.meta.intentJti).toBe("intent-1");
    expect(consumeEphemeralClaims("user-1")).toBeNull();
  });

  it("rejects concurrent stage attempts for the same user", async () => {
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

    expect(consumeEphemeralClaims("user-1")).toBeNull();

    expect(
      await storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-exp-2", scopes)
      )
    ).toEqual({ ok: true });
  });
});
