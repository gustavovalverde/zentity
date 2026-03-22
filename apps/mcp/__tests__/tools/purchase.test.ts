import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockOAuthContext = {
  accessToken: "test-token",
  clientId: "test-client",
  dpopKey: {
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  },
  loginHint: "user-sub",
};

const mockRuntimeState = {
  display: {
    model: "unknown",
    name: "Unknown Agent",
    runtime: "node",
    version: "unknown",
  },
  grants: [],
  hostId: "host-123",
  sessionId: "session-123",
  sessionPrivateKey: { kty: "OKP", crv: "Ed25519", d: "priv", x: "pub" },
  sessionPublicKey: { kty: "OKP", crv: "Ed25519", x: "pub" },
};

const mockAuthContext = {
  oauth: mockOAuthContext,
  runtime: mockRuntimeState,
};

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "stdio",
  },
}));

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../src/auth/context.js", () => ({
  getAuthContext: () => mockAuthContext,
  getOAuthContext: () => mockOAuthContext,
  requireAuth: () => Promise.resolve(mockAuthContext),
  requireRuntimeState: () => mockRuntimeState,
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
  logPendingApprovalHandoff: vi.fn(),
  requestCibaApproval: mockRequestCibaApproval,
}));

const { mockRedeemRelease } = vi.hoisted(() => ({
  mockRedeemRelease: vi.fn(),
}));

vi.mock("../../src/auth/identity.js", () => ({
  redeemRelease: mockRedeemRelease,
}));

const { mockSignAgentAssertion } = vi.hoisted(() => ({
  mockSignAgentAssertion: vi.fn(),
}));

vi.mock("../../src/auth/agent-registration.js", () => ({
  signAgentAssertion: mockSignAgentAssertion,
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CibaDeniedError } from "../../src/auth/ciba.js";
import { createServer } from "../../src/server/index.js";

describe("purchase", () => {
  beforeEach(() => {
    mockRequestCibaApproval.mockReset();
    mockRedeemRelease.mockReset();
    mockSignAgentAssertion.mockReset();
    mockSignAgentAssertion.mockResolvedValue("mock-agent-assertion");
    mockRuntimeState.display = {
      model: "unknown",
      name: "Unknown Agent",
      runtime: "node",
      version: "unknown",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createConnectedClient(
    clientName = "test-client",
    clientVersion = "0.1.0"
  ) {
    const { server } = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: clientName, version: clientVersion });
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

  it("returns approved with PII from release endpoint", async () => {
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
    });
    mockRedeemRelease.mockResolvedValueOnce({
      name: "Jane Doe",
      address: "123 Main St",
      given_name: "Jane",
      family_name: "Doe",
    });

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "purchase",
      arguments: PURCHASE_ARGS,
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.approved).toBe(true);
    expect(parsed.pii).toEqual({ name: "Jane Doe", address: "123 Main St" });
    expect(parsed.binding_message).toContain("Widget Pro");
    expect(parsed.binding_message).toContain("Acme Store");
    expect(mockRedeemRelease).toHaveBeenCalledWith(
      "ciba-token",
      mockOAuthContext.dpopKey
    );
  });

  it("returns approved with null PII when release returns nothing", async () => {
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
    });
    mockRedeemRelease.mockResolvedValueOnce(null);

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "purchase",
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
      name: "purchase",
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
    mockRedeemRelease.mockResolvedValueOnce(null);

    const client = await createConnectedClient();
    await client.callTool({
      name: "purchase",
      arguments: PURCHASE_ARGS,
    });

    expect(mockRequestCibaApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        agentAssertion: "mock-agent-assertion",
        authorizationDetails: [
          expect.objectContaining({
            type: "purchase",
            merchant: "Acme Store",
            item: "Widget Pro",
            amount: { value: "49.99", currency: "USD" },
          }),
        ],
        scope: "openid identity.name identity.address",
      })
    );
  });

  it("sends detected agent name in CIBA request when using known client", async () => {
    mockRuntimeState.display = {
      model: "claude",
      name: "Claude Code",
      runtime: "node",
      version: "1.5.0",
    };
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
    });
    mockRedeemRelease.mockResolvedValueOnce(null);

    const client = await createConnectedClient("claude-code", "1.5.0");
    await client.callTool({
      name: "purchase",
      arguments: PURCHASE_ARGS,
    });

    const cibaCall = mockRequestCibaApproval.mock.calls[0]?.[0];
    expect(cibaCall.agentAssertion).toBe("mock-agent-assertion");
    expect(cibaCall.bindingMessage).toContain("Claude Code: ");
  });

  it("prefixes binding message with agent name", async () => {
    mockRuntimeState.display = {
      model: "claude",
      name: "Claude Code",
      runtime: "node",
      version: "1.0.0",
    };
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
    });
    mockRedeemRelease.mockResolvedValueOnce(null);

    const client = await createConnectedClient("claude-code", "1.0.0");
    await client.callTool({
      name: "purchase",
      arguments: PURCHASE_ARGS,
    });

    const cibaCall = mockRequestCibaApproval.mock.calls[0]?.[0];
    expect(cibaCall.bindingMessage).toContain("Claude Code: ");
    expect(cibaCall.bindingMessage).toContain("Widget Pro");
  });

  it("passes through unknown agent names verbatim", async () => {
    mockRuntimeState.display = {
      model: "unknown",
      name: "my-custom-agent",
      runtime: "node",
      version: "2.0.0",
    };
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
    });
    mockRedeemRelease.mockResolvedValueOnce(null);

    const client = await createConnectedClient("my-custom-agent", "2.0.0");
    await client.callTool({
      name: "purchase",
      arguments: PURCHASE_ARGS,
    });

    const cibaCall = mockRequestCibaApproval.mock.calls[0]?.[0];
    expect(cibaCall.bindingMessage).toContain("my-custom-agent: ");
  });

  it("includes a signed agent assertion on the CIBA request", async () => {
    mockRequestCibaApproval.mockResolvedValueOnce({
      accessToken: "ciba-token",
    });
    mockRedeemRelease.mockResolvedValueOnce(null);

    const client = await createConnectedClient();
    await client.callTool({
      name: "purchase",
      arguments: PURCHASE_ARGS,
    });

    const cibaCall = mockRequestCibaApproval.mock.calls[0]?.[0];
    expect(cibaCall.agentAssertion).toBe("mock-agent-assertion");
    expect(mockSignAgentAssertion).toHaveBeenCalledWith(
      mockRuntimeState,
      expect.stringContaining("Purchase Widget Pro")
    );
  });
});
