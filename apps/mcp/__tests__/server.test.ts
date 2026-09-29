import { describe, expect, it } from "vitest";
import { connectClient } from "./helpers/mcp-client.js";

describe("createServer", () => {
  it("connects and lists tools", async () => {
    const client = await connectClient();

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});
