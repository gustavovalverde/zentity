import { afterEach, describe, expect, it, vi } from "vitest";

const mockOAuthContext = {
  accessToken: "test-token",
  clientId: "test-client",
  dpopKey: {
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  },
  loginHint: "user-sub",
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

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../src/auth/context.js", () => ({
  getAuthContext: () => mockAuthContext,
  getOAuthContext: () => mockOAuthContext,
  requireAuth: () => Promise.resolve(mockAuthContext),
}));

vi.mock("../../src/auth/ciba.js", () => ({
  CibaDeniedError: class extends Error {},
  CibaTimeoutError: class extends Error {},
  logPendingApprovalHandoff: vi.fn(),
  requestCibaApproval: vi.fn(),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server/index.js";

describe("my_proofs", () => {
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

  it("returns checks and proof summaries for verified user", async () => {
    const checksData = {
      method: "ocr",
      level: "full",
      verified: true,
      checks: [
        {
          checkType: "document",
          passed: true,
          source: "zk_proof",
          evidenceRef: "p1",
        },
        {
          checkType: "age",
          passed: true,
          source: "zk_proof",
          evidenceRef: "p2",
        },
        {
          checkType: "liveness",
          passed: true,
          source: "signed_claim",
          evidenceRef: "c1",
        },
        {
          checkType: "face_match",
          passed: true,
          source: "zk_proof",
          evidenceRef: "p3",
        },
        {
          checkType: "nationality",
          passed: true,
          source: "zk_proof",
          evidenceRef: "p4",
        },
        {
          checkType: "identity_binding",
          passed: true,
          source: "zk_proof",
          evidenceRef: "p5",
        },
        {
          checkType: "sybil_resistant",
          passed: true,
          source: "dedup_key",
          evidenceRef: "v1",
        },
      ],
    };
    const proofsData = {
      method: "ocr",
      proofs: [
        {
          proofSystem: "noir_ultrahonk",
          proofType: "age_verification",
          proofHash: "h1",
          verified: true,
          createdAt: "2026-03-01",
        },
        {
          proofSystem: "noir_ultrahonk",
          proofType: "doc_validity",
          proofHash: "h2",
          verified: true,
          createdAt: "2026-03-01",
        },
        {
          proofSystem: "noir_ultrahonk",
          proofType: "nationality_membership",
          proofHash: "h3",
          verified: true,
          createdAt: "2026-03-01",
        },
        {
          proofSystem: "noir_ultrahonk",
          proofType: "face_match",
          proofHash: "h4",
          verified: true,
          createdAt: "2026-03-01",
        },
        {
          proofSystem: "noir_ultrahonk",
          proofType: "identity_binding",
          proofHash: "h5",
          verified: true,
          createdAt: "2026-03-01",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: checksData } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: proofsData } }), {
          status: 200,
        })
      );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "my_proofs",
      arguments: {},
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.isOver18).toBe(true);
    expect(parsed.verificationMethod).toBe("ocr");
    expect(parsed.verificationLevel).toBe("full");
    expect(parsed.verified).toBe(true);
    expect(parsed.checks).toHaveLength(7);
    expect(parsed.totalProofs).toBe(5);
  });

  it("returns empty state when no verification exists", async () => {
    const checksData = {
      method: null,
      level: "none",
      verified: false,
      checks: [],
    };
    const proofsData = {
      method: null,
      proofs: [],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: checksData } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: proofsData } }), {
          status: 200,
        })
      );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "my_proofs",
      arguments: {},
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.isOver18).toBeNull();
    expect(parsed.verified).toBe(false);
    expect(parsed.totalProofs).toBe(0);
    expect(parsed.checks).toHaveLength(0);
  });
});
