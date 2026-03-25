import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "http",
  },
}));

import { getResourceMetadata } from "../../src/auth/resource-metadata.js";

describe("Resource Metadata (RFC 9728)", () => {
  it("returns valid PRM structure", () => {
    const metadata = getResourceMetadata();

    expect(metadata.resource).toBe("http://localhost:3200");
    expect(metadata.authorization_servers).toEqual([
      "http://localhost:3000/api/auth",
    ]);
    expect(metadata.bearer_methods_supported).toEqual(["header", "dpop"]);
    expect(metadata.scopes_supported).toEqual([
      "openid",
      "email",
      "compliance:key:read",
      "proof:identity",
    ]);
  });
});
