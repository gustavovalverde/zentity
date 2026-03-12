import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    port: 3200,
    transport: "stdio",
  },
}));

vi.mock("../../src/auth/credentials.js", () => ({
  loadCredentials: () => ({
    zentityUrl: "http://localhost:3000",
    clientId: "test-client",
    dpopJwk: { kty: "EC", crv: "P-256" },
    dpopPublicJwk: { kty: "EC", crv: "P-256" },
  }),
}));

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
  loadDpopKey: () => ({
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  }),
}));

vi.mock("../../src/auth/context.js", () => ({
  getAuthContext: () => ({
    accessToken: "test-token",
    clientId: "test-client",
    loginHint: "user-sub",
  }),
}));

vi.mock("../../src/auth/ciba.js", () => ({
  CibaDeniedError: class extends Error {},
  CibaTimeoutError: class extends Error {},
  requestCibaApproval: vi.fn(),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server/index.js";

describe("zentity_verify_identity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("returns tier profile on success", async () => {
    const tierData = { tier: 2, proofs: ["age", "nationality"], aal: "aal2" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { data: tierData } }), {
        status: 200,
      })
    );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "zentity_verify_identity",
      arguments: {},
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.tier).toBe(2);
    expect(parsed.proofs).toEqual(["age", "nationality"]);
  });

  it("returns error on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "zentity_verify_identity",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "401"
    );
  });
});
