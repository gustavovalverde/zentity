import { describe, expect, it } from "vitest";
import { parseCliArgs, resolveDpopNonceSecret } from "../config.js";

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

describe("parseCliArgs", () => {
  it("defaults to stdio on port 3300", () => {
    expect(parseCliArgs([])).toEqual({ port: 3300, transport: "stdio" });
  });

  it("reads space and equals forms and ignores unknown flags", () => {
    expect(
      parseCliArgs(["--transport", "http", "--port=4000", "--other"])
    ).toEqual({ port: 4000, transport: "http" });
  });

  it("rejects an unknown transport", () => {
    expect(() => parseCliArgs(["--transport", "ws"])).toThrow(
      '--transport must be "stdio" or "http"'
    );
  });

  it("rejects a port that is missing or not a number", () => {
    expect(() => parseCliArgs(["--port"])).toThrow("--port must be");
    expect(() => parseCliArgs(["--port", "abc"])).toThrow("--port must be");
  });
});
