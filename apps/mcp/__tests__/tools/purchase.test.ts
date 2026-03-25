import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBeginOrResumeInteractiveFlow = vi.fn();
const mockSignAgentAssertion = vi.fn();

const mockOAuthContext = {
  accessToken: "test-token",
  accountSub: "user-123",
  clientId: "test-client",
  dpopKey: {
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  },
  loginHint: "user@example.com",
};

const mockRuntimeState = {
  display: {
    model: "claude",
    name: "Claude Code",
    runtime: "node",
    version: "1.0.0",
  },
  grants: [],
  hostId: "host-123",
  sessionId: "session-123",
  sessionPrivateKey: { kty: "OKP", crv: "Ed25519", d: "priv", x: "pub" },
  sessionPublicKey: { kty: "OKP", crv: "Ed25519", x: "pub" },
};

vi.mock("../../src/auth/context.js", () => ({
  requireAuth: () => Promise.resolve({ oauth: mockOAuthContext }),
  getOAuthContext: () => mockOAuthContext,
  tryGetRuntimeState: () => mockRuntimeState,
}));

vi.mock("../../src/auth/interactive-tool-flow.js", () => ({
  beginOrResumeInteractiveFlow: (...args: unknown[]) =>
    mockBeginOrResumeInteractiveFlow(...args),
  throwUrlElicitationIfSupported: vi.fn(),
}));

vi.mock("../../src/auth/agent-registration.js", () => ({
  signAgentAssertion: (...args: unknown[]) => mockSignAgentAssertion(...args),
}));

import { createServer } from "../../src/server/index.js";

describe("purchase", () => {
  beforeEach(() => {
    mockBeginOrResumeInteractiveFlow.mockReset();
    mockSignAgentAssertion.mockReset();
    mockSignAgentAssertion.mockResolvedValue("agent-assertion");
  });

  async function createConnectedClient() {
    const { server } = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "claude-code", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    return client;
  }

  const purchaseArgs = {
    merchant: "Acme Store",
    amount: 49.99,
    currency: "USD",
    item: "Widget Pro",
  };

  it("returns typed purchase data after approval", async () => {
    mockBeginOrResumeInteractiveFlow.mockResolvedValue({
      status: "complete",
      data: {
        status: "complete",
        approved: true,
        bindingMessage: "Claude Code: Purchase Widget Pro from Acme Store",
        fulfillment: {
          name: "Ada Lovelace",
          address: { formatted: "123 Main St" },
        },
      },
    });

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "purchase",
      arguments: purchaseArgs,
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.status).toBe("complete");
    expect(parsed.approved).toBe(true);
    expect(parsed.fulfillment.name).toBe("Ada Lovelace");
  });

  it("returns structured fallback interaction data while approval is pending", async () => {
    mockBeginOrResumeInteractiveFlow.mockResolvedValue({
      status: "needs_user_action",
      interaction: {
        mode: "url",
        url: "http://localhost:3000/mcp/interactive/interaction-1",
        message: "Open the link to continue.",
        expiresAt: "2026-03-24T10:00:00.000Z",
      },
    });

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "purchase",
      arguments: purchaseArgs,
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.status).toBe("needs_user_action");
    expect(parsed.interaction.url).toContain("/mcp/interactive/");
  });

  it("includes description in the interactive deduplication fingerprint", async () => {
    mockBeginOrResumeInteractiveFlow.mockResolvedValue({
      status: "needs_user_action",
      interaction: {
        mode: "url",
        url: "http://localhost:3000/mcp/interactive/interaction-1",
        message: "Open the link to continue.",
        expiresAt: "2026-03-24T10:00:00.000Z",
      },
    });

    const client = await createConnectedClient();
    await client.callTool({
      name: "purchase",
      arguments: {
        ...purchaseArgs,
        description: "For the office team lunch",
      },
    });

    expect(mockBeginOrResumeInteractiveFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: expect.stringContaining("For the office team lunch"),
      })
    );
  });
});
