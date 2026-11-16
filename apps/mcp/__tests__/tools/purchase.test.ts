import type { CreateX402FetchOptions } from "@zentity/sdk";
import {
  buildAuthHintsExtension,
  buildZentityExtension,
  createPaymentRequired,
  type DpopClient,
  PAYMENT_SIGNATURE_HEADER,
  type PaymentRequirement,
  PROOF_OF_HUMAN_CHALLENGE,
} from "@zentity/sdk/rp";
import { decodeProtectedHeader } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBeginOrResumeInteractiveFlow = vi.fn();
const mockSignAgentAssertion = vi.fn();

const ISSUER = "http://localhost:3000/api/auth";
const MERCHANT_URL =
  "https://merchant.example/api/x402/access?resourceId=verified-identity";

const mockOAuthContext = {
  accessToken: "test-token",
  accountSub: "user-123",
  clientId: "test-client",
  dpopClient: {
    proofFor: vi.fn().mockResolvedValue("mock-proof"),
    fetch: vi.fn(),
    keyPair: { publicJwk: { kty: "EC", crv: "P-256", x: "installation" } },
  },
  dpopKey: {
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  },
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

vi.mock("../../src/services/interactive-approval.js", () => ({
  beginOrResumeInteractiveFlow: (...args: unknown[]) =>
    mockBeginOrResumeInteractiveFlow(...args),
  requestUserAction: (
    _server: unknown,
    _ctx: unknown,
    _interaction: unknown,
    result: unknown
  ) => result,
}));

vi.mock("../../src/runtime/agent-registration.js", () => ({
  signAgentAssertion: (...args: unknown[]) => mockSignAgentAssertion(...args),
}));

vi.mock("../../src/oauth-client.js", () => ({
  discoverMcpOAuth: () => Promise.resolve({ issuer: ISSUER }),
}));

import { connectClient } from "../helpers/mcp-client.js";

function requirement(
  overrides: Partial<PaymentRequirement> = {}
): PaymentRequirement {
  return {
    scheme: "exact",
    network: "eip155:84532",
    amount: "1",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x000000000000000000000000000000000000dEaD",
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  };
}

function merchant402(accepted = requirement()): Response {
  return createPaymentRequired({
    accepts: [accepted],
    resource: { url: MERCHANT_URL },
    description: "Financial analytics",
    extensions: {
      "auth-hints": buildAuthHintsExtension({
        acceptIndexes: [0],
        authorizationServer: ISSUER,
        tokenEndpoint: `${ISSUER}/oauth2/token`,
      }),
      zentity: buildZentityExtension({ minIdentityStrength: "documentary" }),
    },
    wwwAuthenticate: PROOF_OF_HUMAN_CHALLENGE,
  });
}

const POH_TOKEN = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
  JSON.stringify({
    poh: {
      identity: { strength_at_least: "documentary" },
      policy: { version: "v1.0" },
    },
  })
).toString("base64url")}.`;

function stubSchemeClient(): NonNullable<
  CreateX402FetchOptions["schemeClient"]
> {
  return {
    scheme: "exact",
    createPaymentPayload: (x402Version) =>
      Promise.resolve({ x402Version, payload: { signature: "0xstub" } }),
  };
}

function parse(result: unknown) {
  return JSON.parse(
    (
      (result as { content: Array<{ text: string }> }).content[0] as {
        text: string;
      }
    ).text
  );
}

/** A merchant that answers 402 until the payment arrives. */
function mockNetwork(merchantRequirements: PaymentRequirement[] = []) {
  const requests: { headers: Headers; url: string }[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const headers = new Headers(init?.headers ?? request.headers);
      requests.push({ url: request.url, headers });
      if (request.url.endsWith("/oauth2/proof-of-human")) {
        return Promise.resolve(
          Response.json({
            token: POH_TOKEN,
            token_type: "DPoP",
            expires_in: 300,
          })
        );
      }
      if (headers.get(PAYMENT_SIGNATURE_HEADER)) {
        return Promise.resolve(Response.json({ access: "granted" }));
      }
      return Promise.resolve(
        merchant402(merchantRequirements.shift() ?? requirement())
      );
    });
  return { requests, spy };
}

/** Approves every interactive flow at once, as the user would. */
function approveFlows() {
  const flows: Record<string, unknown>[] = [];
  mockBeginOrResumeInteractiveFlow.mockImplementation(
    async (params: {
      approval: { authorizationDetails?: unknown[] };
      createFlowDpopClient?: () => Promise<DpopClient>;
      onApproved: (tokenSet: unknown, dpopClient: unknown) => Promise<unknown>;
    }) => {
      flows.push(params);
      const dpopClient = params.createFlowDpopClient
        ? await params.createFlowDpopClient()
        : mockOAuthContext.dpopClient;
      return {
        status: "complete",
        data: await params.onApproved(
          {
            accessToken: "opaque-x402-token",
            authorizationDetails: params.approval.authorizationDetails,
            expiresAt: Date.now() + 120_000,
          },
          dpopClient
        ),
      };
    }
  );
  return flows;
}

describe("purchase", () => {
  beforeEach(() => {
    mockBeginOrResumeInteractiveFlow.mockReset();
    mockSignAgentAssertion.mockReset();
    mockSignAgentAssertion.mockResolvedValue("agent-assertion");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const purchaseArgs = {
    merchant: "Acme Store",
    amount: 49.99,
    currency: "EUR",
    item: "Widget Pro",
  };

  it("requests the strict purchase entry and returns fulfillment after approval", async () => {
    mockBeginOrResumeInteractiveFlow.mockResolvedValue({
      status: "complete",
      data: {
        status: "approved",
        approved: true,
        bindingMessage: "Buy from Acme Store",
        fulfillment: {
          name: "Ada Lovelace",
          address: { formatted: "123 Main St" },
        },
      },
    });

    const client = await connectClient({
      auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
      clientName: "claude-code",
    });
    const parsed = parse(
      await client.callTool({ name: "purchase", arguments: purchaseArgs })
    );

    expect(parsed.status).toBe("approved");
    expect(parsed.fulfillment.name).toBe("Ada Lovelace");
    const [params] = mockBeginOrResumeInteractiveFlow.mock.calls[0] ?? [];
    expect(params.approval).toEqual({
      scope: "openid identity.name identity.address",
      bindingMessage: "Buy from Acme Store",
      authorizationDetails: [
        {
          type: "purchase",
          merchant: { name: "Acme Store" },
          item: "Widget Pro",
          amount: { value: "49.99", currency: "EUR" },
        },
      ],
      agentAssertion: "agent-assertion",
    });
    // The assertion signs the request as sent.
    expect(mockSignAgentAssertion).toHaveBeenCalledWith(mockRuntimeState, {
      bindingMessage: "Buy from Acme Store",
      scope: "openid identity.name identity.address",
      authorizationDetails: params.approval.authorizationDetails,
    });
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

    const client = await connectClient({
      auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
      clientName: "claude-code",
    });
    const parsed = parse(
      await client.callTool({ name: "purchase", arguments: purchaseArgs })
    );

    expect(parsed.status).toBe("needs_user_action");
    expect(parsed.interaction.url).toContain("/mcp/interactive/");
  });

  it("refuses a direct purchase without its fields", async () => {
    const client = await connectClient({
      auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
    });
    const result = await client.callTool({
      name: "purchase",
      arguments: { merchant: "Acme Store" },
    });

    expect(result.isError).toBe(true);
    expect(mockBeginOrResumeInteractiveFlow).not.toHaveBeenCalled();
  });

  // D61: the MCP server has no scheme client source yet.
  it("answers payment_not_configured for an x402 purchase without asking the user", async () => {
    const network = mockNetwork();

    const client = await connectClient({
      auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
    });
    const parsed = parse(
      await client.callTool({
        name: "purchase",
        arguments: { url: MERCHANT_URL, maxAmount: 1 },
      })
    );

    expect(parsed.status).toBe("payment_not_configured");
    expect(mockBeginOrResumeInteractiveFlow).not.toHaveBeenCalled();
    expect(network.requests).toHaveLength(1);
  });

  // R25, R16, and R11: a Proof-of-Human for the merchant under a fresh key.
  it("approves an x402 purchase as a Proof-of-Human under a key made for it", async () => {
    const network = mockNetwork();
    const flows = approveFlows();

    const client = await connectClient({
      auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
      server: { purchase: { x402SchemeClient: stubSchemeClient() } },
    });
    const parsed = parse(
      await client.callTool({
        name: "purchase",
        arguments: { url: MERCHANT_URL, maxAmount: 1 },
      })
    );

    expect(parsed.status).toBe("approved");
    expect(parsed.bindingMessage).toBe("Proof-of-Human for merchant.example");
    expect(parsed.x402).toEqual(
      expect.objectContaining({ identity_strength: "documentary", status: 200 })
    );
    const [flow] = flows as [
      { approval: Record<string, unknown>; createFlowDpopClient: unknown },
    ];
    expect(flow.createFlowDpopClient).toBeTypeOf("function");
    expect(flow.approval.scope).toBe("openid poh");
    expect(flow.approval.bindingMessage).toBe(
      "Proof-of-Human for merchant.example"
    );
    const [entry] = flow.approval.authorizationDetails as [
      Record<string, unknown>,
    ];
    expect(entry).toEqual({
      type: "x402_purchase",
      resource_url: MERCHANT_URL,
      resource_description: "Financial analytics",
      payment_requirements: requirement(),
      min_identity_strength: "documentary",
    });

    const keyOf = (path: string) => {
      const sent = network.requests.find(
        (request) => request.url.includes(path) && request.headers.get("DPoP")
      );
      return (
        decodeProtectedHeader(sent?.headers.get("DPoP") as string).jwk as {
          x: string;
        }
      ).x;
    };
    expect(keyOf("/oauth2/proof-of-human")).toBe(keyOf("/api/x402/access"));
    expect(keyOf("/api/x402/access")).not.toBe("installation");
  });

  // R30: the approval covers one requirement; a changed 402 is a new one.
  it("starts a new approval when the merchant changes its requirement", async () => {
    mockNetwork([requirement(), requirement({ amount: "2" })]);
    const flows = approveFlows();
    const client = await connectClient({
      auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
      server: { purchase: { x402SchemeClient: stubSchemeClient() } },
    });

    for (let call = 0; call < 2; call++) {
      await client.callTool({
        name: "purchase",
        arguments: { url: MERCHANT_URL, maxAmount: 1 },
      });
    }

    const fingerprints = flows.map(
      (flow) => (flow as { fingerprint: string }).fingerprint
    );
    expect(fingerprints).toHaveLength(2);
    expect(fingerprints[1]).not.toBe(fingerprints[0]);
  });

  it("answers approval_mismatch when Zentity approved other terms", async () => {
    mockNetwork();
    mockBeginOrResumeInteractiveFlow.mockImplementation(
      async (params: {
        createFlowDpopClient: () => Promise<DpopClient>;
        onApproved: (t: unknown, d: unknown) => Promise<unknown>;
      }) => ({
        status: "complete",
        data: await params.onApproved(
          {
            accessToken: "opaque-x402-token",
            authorizationDetails: [{ type: "x402_purchase", amount: "9" }],
            expiresAt: Date.now() + 120_000,
          },
          await params.createFlowDpopClient()
        ),
      })
    );

    const client = await connectClient({
      auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
      server: { purchase: { x402SchemeClient: stubSchemeClient() } },
    });
    const parsed = parse(
      await client.callTool({
        name: "purchase",
        arguments: { url: MERCHANT_URL, maxAmount: 1 },
      })
    );

    expect(parsed.status).toBe("approval_mismatch");
  });

  it.each([
    ["payment_bounds_exceeded", { maxAmount: 0.000_000_5 }],
    ["identity_strength_bound_exceeded", { maxIdentityStrength: "none" }],
  ])("answers %s before asking the user", async (status, bounds) => {
    mockNetwork();
    const client = await connectClient({
      auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
      server: { purchase: { x402SchemeClient: stubSchemeClient() } },
    });

    const result = await client.callTool({
      name: "purchase",
      arguments: { url: MERCHANT_URL, maxAmount: 1, ...bounds },
    });

    if (status === "identity_strength_bound_exceeded") {
      // "none" is outside the input enum, so the tool refuses the input.
      expect(result.isError).toBe(true);
    } else {
      expect(parse(result).status).toBe(status);
    }
    expect(mockBeginOrResumeInteractiveFlow).not.toHaveBeenCalled();
  });

  it.each(["denied", "expired"] as const)(
    "returns %s when the x402 approval ends that way",
    async (status) => {
      const network = mockNetwork();
      mockBeginOrResumeInteractiveFlow.mockResolvedValue({ status });

      const client = await connectClient({
        auth: { oauth: mockOAuthContext, runtime: mockRuntimeState },
        server: { purchase: { x402SchemeClient: stubSchemeClient() } },
      });
      const parsed = parse(
        await client.callTool({
          name: "purchase",
          arguments: { url: MERCHANT_URL, maxAmount: 1 },
        })
      );

      expect(parsed.status).toBe(status);
      expect(parsed.approved).toBe(false);
      expect(network.requests).toHaveLength(1);
    }
  );
});
