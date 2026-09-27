import { afterEach, describe, expect, it, vi } from "vitest";

const mockOAuthContext = {
  accessToken: "test-token",
  clientId: "test-client",
  dpopClient: {
    proofFor: vi.fn().mockResolvedValue("mock-proof"),
    withNonceRetry: async (
      attempt: (nonce?: string) => Promise<{ response: Response }>
    ) => {
      const initial = await attempt();
      if (initial.response.status !== 400 && initial.response.status !== 401) {
        return initial;
      }
      const nonce = initial.response.headers.get("DPoP-Nonce");
      return nonce ? attempt(nonce) : initial;
    },
  },
  dpopKey: {
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  },
};

const mockAuthContext = {
  oauth: mockOAuthContext,
};

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
    port: 3200,
    transport: "stdio",
  },
}));

vi.mock("../../src/runtime/auth-context.js", () => ({
  getAuthContext: () => mockAuthContext,
  getOAuthContext: () => mockOAuthContext,
  requireAuth: () => Promise.resolve(mockAuthContext),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

describe("check_compliance", () => {
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

  const NETWORKS_PAYLOAD = {
    networks: [
      {
        id: "sepolia",
        name: "Sepolia",
        chainId: 11_155_111,
        type: "fhevm",
        features: ["encrypted"],
        explorer: "https://sepolia.etherscan.io",
        identityRegistry: "0xregistry",
        complianceRules: null,
        attestation: {
          id: "att-1",
          status: "confirmed",
          txHash: "0xabc",
          blockNumber: 42,
          confirmedAt: "2026-03-10T12:00:00.000Z",
          errorMessage: null,
          explorerUrl: "https://sepolia.etherscan.io/tx/0xabc",
          walletAddress: "0xwallet",
        },
      },
      {
        id: "hardhat",
        name: "Hardhat",
        chainId: 31_337,
        type: "fhevm",
        features: [],
        explorer: null,
        identityRegistry: null,
        complianceRules: null,
        attestation: null,
      },
    ],
  };

  function mockNetworksResponse() {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { data: NETWORKS_PAYLOAD } }), {
        status: 200,
      })
    );
  }

  it("maps the attestation networks payload to the tool output", async () => {
    mockNetworksResponse();

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "check_compliance",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      attested: true,
      lastAttestation: "2026-03-10T12:00:00.000Z",
      networks: [
        {
          id: "sepolia",
          name: "Sepolia",
          attested: true,
          status: "confirmed",
          explorerUrl: "https://sepolia.etherscan.io/tx/0xabc",
        },
        {
          id: "hardhat",
          name: "Hardhat",
          attested: false,
          status: null,
          explorerUrl: null,
        },
      ],
    });
  });

  it("filters to the requested network", async () => {
    mockNetworksResponse();

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "check_compliance",
      arguments: { network: "hardhat" },
    });

    expect(result.structuredContent).toEqual({
      attested: false,
      lastAttestation: null,
      networks: [
        {
          id: "hardhat",
          name: "Hardhat",
          attested: false,
          status: null,
          explorerUrl: null,
        },
      ],
    });
  });

  it("rejects an unknown network", async () => {
    mockNetworksResponse();

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "check_compliance",
      arguments: { network: "mainnet" },
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "sepolia, hardhat"
    );
  });

  it("returns error on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server error", { status: 500 })
    );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "check_compliance",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      "500"
    );
  });
});
