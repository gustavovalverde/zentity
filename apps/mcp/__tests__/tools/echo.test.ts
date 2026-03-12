import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/server/index.js";

describe("zentity_echo tool", () => {
  async function createConnectedClient() {
    const { server } = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    return client;
  }

  it("lists zentity_echo in tools/list", async () => {
    const client = await createConnectedClient();
    const { tools } = await client.listTools();
    const echo = tools.find((t) => t.name === "zentity_echo");
    expect(echo).toBeDefined();
    expect(echo?.description).toContain("Echo");
  });

  it("echoes back the provided message", async () => {
    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "zentity_echo",
      arguments: { message: "hello world" },
    });
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("handles empty string", async () => {
    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "zentity_echo",
      arguments: { message: "" },
    });
    expect(result.content).toEqual([{ type: "text", text: "" }]);
  });
});
