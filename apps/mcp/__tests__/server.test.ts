import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server/index.js";

describe("createServer", () => {
  it("returns server and cleanup function", () => {
    const result = createServer();
    expect(result.server).toBeDefined();
    expect(typeof result.cleanup).toBe("function");
  });

  it("connects and responds to initialize", async () => {
    const { server } = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});
