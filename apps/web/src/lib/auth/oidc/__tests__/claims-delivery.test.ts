import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeEphemeralClaimsByUser,
  storeEphemeralClaims,
} from "../ephemeral-identity-claims";

function resetEphemeralStore() {
  const key = Symbol.for("zentity.ephemeral-identity-claims");
  const g = globalThis as Record<symbol, Map<string, unknown> | undefined>;
  g[key]?.clear();
}

describe("ephemeral claims delivery (userinfo-only)", () => {
  beforeEach(() => {
    resetEphemeralStore();
  });

  it("consumeEphemeralClaimsByUser returns and removes entry", async () => {
    await storeEphemeralClaims(
      "user-1",
      { name: "Alice", birthdate: "1990-01-01" },
      ["openid", "identity.name", "identity.dob"],
      { clientId: "client-1", intentJti: "jti-1", scopeHash: "hash-1" }
    );

    const consumed = consumeEphemeralClaimsByUser("user-1");
    expect(consumed).not.toBeNull();
    expect(consumed?.claims.name).toBe("Alice");
    expect(consumed?.claims.birthdate).toBe("1990-01-01");

    // Second consume returns null (single-consume)
    expect(consumeEphemeralClaimsByUser("user-1")).toBeNull();
  });

  it("returns null for multiple clients (cross-client safety)", async () => {
    await storeEphemeralClaims("user-2", { name: "Alice" }, ["openid"], {
      clientId: "client-a",
      intentJti: "jti-2a",
      scopeHash: "hash-2a",
    });
    await storeEphemeralClaims("user-2", { name: "Bob" }, ["openid"], {
      clientId: "client-b",
      intentJti: "jti-2b",
      scopeHash: "hash-2b",
    });

    expect(consumeEphemeralClaimsByUser("user-2")).toBeNull();
  });

  it("respects custom TTL via storeEphemeralClaims", async () => {
    const result = await storeEphemeralClaims(
      "user-3",
      { name: "Bob" },
      ["openid", "identity.name"],
      { clientId: "client-3", intentJti: "jti-3", scopeHash: "hash-3" },
      10 * 60 * 1000 // 10-minute CIBA TTL
    );

    expect(result.ok).toBe(true);

    const consumed = consumeEphemeralClaimsByUser("user-3");
    expect(consumed?.claims.name).toBe("Bob");
  });
});
