import { describe, expect, it } from "vitest";

import { requireHttpClientCredentials } from "../src/config.js";

describe("requireHttpClientCredentials", () => {
  it("returns the provisioned client", () => {
    expect(
      requireHttpClientCredentials({
        MCP_CLIENT_ID: "mcp-client",
        MCP_CLIENT_SECRET: "secret",
      })
    ).toEqual({ clientId: "mcp-client", clientSecret: "secret" });
  });

  it.each([
    ["no client", {}],
    ["a client without its secret", { MCP_CLIENT_ID: "mcp-client" }],
  ])("refuses to start the HTTP transport with %s", (_case, env) => {
    expect(() => requireHttpClientCredentials(env)).toThrow(
      "Run `pnpm mcp:provision` in apps/web"
    );
  });
});
