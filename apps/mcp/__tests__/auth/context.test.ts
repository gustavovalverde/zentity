import { beforeEach, describe, expect, it } from "vitest";
import {
  getAuthContext,
  runWithAuth,
  setDefaultAuth,
} from "../../src/auth/context.js";

describe("AuthContext", () => {
  beforeEach(() => {
    setDefaultAuth(undefined);
  });

  it("provides auth context inside runWithAuth", () => {
    const ctx = {
      accessToken: "token-abc",
      clientId: "client-1",
      dpopKey: {
        privateJwk: { kty: "EC", crv: "P-256" },
        publicJwk: { kty: "EC", crv: "P-256" },
      },
      loginHint: "user-sub",
    };

    const result = runWithAuth(ctx, () => {
      const retrieved = getAuthContext();
      return retrieved.loginHint;
    });

    expect(result).toBe("user-sub");
  });

  it("throws when accessed outside runWithAuth", () => {
    expect(() => getAuthContext()).toThrow("Not authenticated");
  });
});
