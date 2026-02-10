import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.useRealTimers();
    resetEphemeralIdentityClaimsStore();
  });

  it("stores and consumes claims once", () => {
    const scopes = ["openid", "identity.name"];

    const storeResult = storeEphemeralClaims(
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

  it("rejects reused identity intent jti", () => {
    const scopes = ["openid", "identity.name"];

    expect(
      storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        makeMeta("intent-reused", scopes)
      )
    ).toEqual({ ok: true });

    consumeEphemeralClaims("user-1");

    expect(
      storeEphemeralClaims(
        "user-2",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-reused", scopes)
      )
    ).toEqual({ ok: false, reason: "intent_reused" });
  });

  it("rejects concurrent stage attempts for the same user", () => {
    const scopes = ["openid", "identity.name"];

    expect(
      storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        makeMeta("intent-3", scopes)
      )
    ).toEqual({ ok: true });

    expect(
      storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-4", scopes)
      )
    ).toEqual({ ok: false, reason: "concurrent_stage" });
  });

  it("evicts expired entries and allows fresh stage flow", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const scopes = ["openid", "identity.name"];
    expect(
      storeEphemeralClaims(
        "user-1",
        { given_name: "Ada" },
        scopes,
        makeMeta("intent-exp", scopes)
      )
    ).toEqual({ ok: true });

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(consumeEphemeralClaims("user-1")).toBeNull();

    expect(
      storeEphemeralClaims(
        "user-1",
        { given_name: "Grace" },
        scopes,
        makeMeta("intent-exp", scopes)
      )
    ).toEqual({ ok: true });
  });
});
