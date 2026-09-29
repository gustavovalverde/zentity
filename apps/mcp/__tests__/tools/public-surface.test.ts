import { describe, expect, it } from "vitest";
import { connectClient } from "../helpers/mcp-client.js";

describe("public MCP surface", () => {
  it("advertises only the alias-first public tools", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "check_compliance",
      "my_profile",
      "my_proofs",
      "purchase",
      "whoami",
    ]);
  });

  it("does not advertise generic approval or echo helpers", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();

    expect(tools.find((tool) => tool.name === "request_approval")).toBeFalsy();
    expect(tools.find((tool) => tool.name === "echo")).toBeFalsy();
  });
});
