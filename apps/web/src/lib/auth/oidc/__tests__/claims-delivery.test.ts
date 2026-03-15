import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeEphemeralClaimsByUser,
  peekEphemeralClaimsByUser,
  resetEphemeralIdentityClaimsStore,
  storeEphemeralClaims,
} from "../ephemeral-identity-claims";

describe("ephemeral claims peek vs consume", () => {
  beforeEach(async () => {
    await resetEphemeralIdentityClaimsStore();
  });

  it("peekEphemeralClaimsByUser reads without consuming", async () => {
    await storeEphemeralClaims(
      "user-1",
      { name: "Alice", birthdate: "1990-01-01" },
      ["openid", "identity.name", "identity.dob"],
      { clientId: "client-1", intentJti: "jti-1", scopeHash: "hash-1" }
    );

    const first = peekEphemeralClaimsByUser("user-1");
    expect(first).not.toBeNull();
    expect(first?.claims.name).toBe("Alice");

    const second = peekEphemeralClaimsByUser("user-1");
    expect(second).not.toBeNull();
    expect(second?.claims.name).toBe("Alice");
  });

  it("consumeEphemeralClaimsByUser removes entry after peek", async () => {
    await storeEphemeralClaims(
      "user-2",
      { name: "Bob" },
      ["openid", "identity.name"],
      { clientId: "client-2", intentJti: "jti-2", scopeHash: "hash-2" }
    );

    const peeked = peekEphemeralClaimsByUser("user-2");
    expect(peeked?.claims.name).toBe("Bob");

    const consumed = consumeEphemeralClaimsByUser("user-2");
    expect(consumed?.claims.name).toBe("Bob");

    expect(peekEphemeralClaimsByUser("user-2")).toBeNull();
    expect(consumeEphemeralClaimsByUser("user-2")).toBeNull();
  });

  it("peek returns null for multiple clients (cross-client safety)", async () => {
    await storeEphemeralClaims("user-3", { name: "Alice" }, ["openid"], {
      clientId: "client-a",
      intentJti: "jti-3a",
      scopeHash: "hash-3a",
    });
    await storeEphemeralClaims("user-3", { name: "Bob" }, ["openid"], {
      clientId: "client-b",
      intentJti: "jti-3b",
      scopeHash: "hash-3b",
    });

    expect(peekEphemeralClaimsByUser("user-3")).toBeNull();
    expect(consumeEphemeralClaimsByUser("user-3")).toBeNull();
  });
});
