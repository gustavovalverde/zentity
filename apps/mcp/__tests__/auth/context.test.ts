import { describe, expect, it } from "vitest";
import { getAuthContext, runWithAuth } from "../../src/auth/context.js";

describe("AuthContext", () => {
  it("provides auth context inside runWithAuth", () => {
    const ctx = {
      accessToken: "token-abc",
      clientId: "client-1",
      loginHint: "user-sub",
    };

    const result = runWithAuth(ctx, () => {
      const retrieved = getAuthContext();
      return retrieved.loginHint;
    });

    expect(result).toBe("user-sub");
  });

  it("throws when accessed outside runWithAuth", () => {
    expect(() => getAuthContext()).toThrow("No auth context");
  });
});
