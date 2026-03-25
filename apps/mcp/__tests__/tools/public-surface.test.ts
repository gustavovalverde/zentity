import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/server/index.js";

describe("public MCP surface", () => {
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

  it("advertises only the alias-first public tools", async () => {
    const client = await createConnectedClient();
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
    const client = await createConnectedClient();
    const { tools } = await client.listTools();

    expect(tools.find((tool) => tool.name === "request_approval")).toBeFalsy();
    expect(tools.find((tool) => tool.name === "echo")).toBeFalsy();
  });
});
