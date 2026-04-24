import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "@zentity/sdk/rp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  sessionDid: "did:key:zSession",
  sessionId: "session-123",
  sessionPrivateKey: { kty: "OKP", crv: "Ed25519", d: "priv", x: "pub" },
  sessionPublicKey: { kty: "OKP", crv: "Ed25519", x: "pub" },
  status: "active",
};

vi.mock("../../src/runtime/auth-context.js", () => ({
  requireAuth: () => Promise.resolve({ oauth: mockOAuthContext }),
  getOAuthContext: () => mockOAuthContext,
  tryGetRuntimeState: () => mockRuntimeState,
}));

vi.mock("../../src/services/interactive-approval.js", () => ({
  beginOrResumeInteractiveFlow: (...args: unknown[]) =>
    mockBeginOrResumeInteractiveFlow(...args),
  throwUrlElicitationIfSupported: vi.fn(),
}));

vi.mock("../../src/runtime/agent-registration.js", () => ({
  signAgentAssertion: (...args: unknown[]) => mockSignAgentAssertion(...args),
}));

import { createServer } from "../../src/server/index.js";

describe("purchase", () => {
  beforeEach(() => {
    mockBeginOrResumeInteractiveFlow.mockReset();
    mockSignAgentAssertion.mockReset();
    mockSignAgentAssertion.mockResolvedValue("agent-assertion");
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  function createX402PaymentRequiredHeader(): string {
    return Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:84532",
            payTo: "0x000000000000000000000000000000000000dEaD",
            amount: "1",
            maxTimeoutSeconds: 300,
            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            extra: {},
          },
        ],
        resource: { url: "https://merchant.example/api/purchase" },
        extensions: {
          zentity: {
            minComplianceLevel: 2,
            pohIssuer: "https://app.zentity.xyz",
          },
        },
      })
    ).toString("base64");
  }

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

  it("fetches an x402 URL with a PoH retry after approval", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("payment required", {
          status: 402,
          headers: {
            [PAYMENT_REQUIRED_HEADER]: createX402PaymentRequiredHeader(),
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access: "granted" }), { status: 200 })
      );
    mockBeginOrResumeInteractiveFlow.mockResolvedValue({
      status: "complete",
      data: "poh-token",
    });

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "purchase",
      arguments: {
        ...purchaseArgs,
        url: "https://merchant.example/api/purchase",
      },
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    const retryRequest = fetchSpy.mock.calls[1]?.[0] as Request;

    expect(parsed.status).toBe("complete");
    expect(parsed.x402).toMatchObject({
      level_used: 2,
      poh_issuer: "https://app.zentity.xyz",
      retried: true,
      status: 200,
    });
    expect(retryRequest.headers.get(PAYMENT_SIGNATURE_HEADER)).toBeTruthy();
    expect(mockBeginOrResumeInteractiveFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        cibaRequest: expect.objectContaining({
          resource: "http://localhost:3000",
          scope: "openid poh",
        }),
      })
    );
  });

  it("returns denied when x402 approval is denied", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("payment required", {
        status: 402,
        headers: {
          [PAYMENT_REQUIRED_HEADER]: createX402PaymentRequiredHeader(),
        },
      })
    );
    mockBeginOrResumeInteractiveFlow.mockResolvedValue({
      status: "denied",
    });

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "purchase",
      arguments: {
        ...purchaseArgs,
        url: "https://merchant.example/api/purchase",
      },
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.status).toBe("denied");
    expect(parsed.approved).toBe(false);
    expect(parsed.fulfillment).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns expired when x402 approval expires", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("payment required", {
        status: 402,
        headers: {
          [PAYMENT_REQUIRED_HEADER]: createX402PaymentRequiredHeader(),
        },
      })
    );
    mockBeginOrResumeInteractiveFlow.mockResolvedValue({
      status: "expired",
    });

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "purchase",
      arguments: {
        ...purchaseArgs,
        url: "https://merchant.example/api/purchase",
      },
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );

    expect(parsed.status).toBe("expired");
    expect(parsed.approved).toBe(false);
    expect(parsed.fulfillment).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
