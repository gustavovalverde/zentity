import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { mockRequestCibaApproval } = vi.hoisted(() => ({
  mockRequestCibaApproval: vi.fn(),
}));

vi.mock("../../src/auth/ciba.js", () => ({
  CibaDeniedError: class CibaDeniedError extends Error {
    name = "CibaDeniedError";
  },
  CibaTimeoutError: class CibaTimeoutError extends Error {
    name = "CibaTimeoutError";
  },
  requestCibaApproval: mockRequestCibaApproval,
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CibaDeniedError } from "../../src/auth/ciba.js";
import { createServer } from "../../src/server/index.js";

describe("zentity_purchase", () => {
  beforeEach(() => {
    mockRequestCibaApproval.mockReset();
  });

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

  const PURCHASE_ARGS = {
    merchant: "Acme Store",
    amount: 49.99,
    currency: "USD",
    item: "Widget Pro",
  };

  it("returns approved with PII when vault is unlocked", async () => {
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
      authorizationDetails: [
        { type: "purchase", merchant: "Acme Store", amount: 49.99 },
      ],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ name: "Jane Doe", address: "123 Main St" }),
        { status: 200 }
      )
    );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "zentity_purchase",
      arguments: PURCHASE_ARGS,
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.approved).toBe(true);
    expect(parsed.pii).toEqual({ name: "Jane Doe", address: "123 Main St" });
    expect(parsed.binding_message).toContain("Widget Pro");
    expect(parsed.binding_message).toContain("Acme Store");
  });

  it("returns approved with null PII when vault is not unlocked", async () => {
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 })
    );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "zentity_purchase",
      arguments: PURCHASE_ARGS,
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.approved).toBe(true);
    expect(parsed.pii).toBeNull();
  });

  it("returns error when user denies", async () => {
    mockRequestCibaApproval.mockRejectedValueOnce(
      new CibaDeniedError("User rejected")
    );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "zentity_purchase",
      arguments: PURCHASE_ARGS,
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "denied"
    );
  });

  it("includes authorization_details in CIBA request", async () => {
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const client = await createConnectedClient();
    await client.callTool({
      name: "zentity_purchase",
      arguments: PURCHASE_ARGS,
    });

    expect(mockRequestCibaApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationDetails: [
          expect.objectContaining({
            type: "purchase",
            merchant: "Acme Store",
            amount: 49.99,
          }),
        ],
        scope: "openid identity.name identity.address",
      })
    );
  });
});
