import { describe, expect, it } from "vitest";
import { resolveDpopNonceSecret } from "../config.js";

describe("resolveDpopNonceSecret", () => {
  it("uses the configured secret", () => {
    const secret = "s".repeat(32);
    expect(resolveDpopNonceSecret(secret)).toBe(secret);
  });

  it("generates a distinct secret per process when none is set", () => {
    const first = resolveDpopNonceSecret(undefined);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(resolveDpopNonceSecret("")).not.toBe(first);
  });

  it("rejects a secret shorter than 32 characters", () => {
    expect(() => resolveDpopNonceSecret("too-short")).toThrow(
      "MCP_DPOP_NONCE_SECRET must be at least 32 characters"
    );
  });
});
