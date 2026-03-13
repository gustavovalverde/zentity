import { afterEach, describe, expect, it, vi } from "vitest";

const mockAuthContext = {
  accessToken: "test-token",
  clientId: "test-client",
  dpopKey: {
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  },
  loginHint: "user-sub",
};

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
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
  requireAuth: () => Promise.resolve(mockAuthContext),
}));

vi.mock("../../src/auth/ciba.js", () => ({
  CibaDeniedError: class extends Error {},
  CibaTimeoutError: class extends Error {},
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

  it("returns age proof and all proof types", async () => {
    const ageProof = {
      proofId: "proof-1",
      isOver18: true,
      createdAt: "2026-03-01",
    };
    const allProofs = [
      { proofId: "p1", proofType: "age_verification", createdAt: "2026-03-01" },
      { proofId: "p2", proofType: "doc_validity", createdAt: "2026-03-01" },
      {
        proofId: "p3",
        proofType: "nationality_membership",
        createdAt: "2026-03-01",
      },
      { proofId: "p4", proofType: "face_match", createdAt: "2026-03-01" },
      {
        proofId: "p5",
        proofType: "identity_binding",
        createdAt: "2026-03-01",
      },
    ];

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: ageProof } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: allProofs } }), {
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
    expect(parsed.hasAgeProof).toBe(true);
    expect(parsed.hasDocValidityProof).toBe(true);
    expect(parsed.hasNationalityProof).toBe(true);
    expect(parsed.hasFaceMatchProof).toBe(true);
    expect(parsed.hasIdentityBindingProof).toBe(true);
    expect(parsed.totalProofs).toBe(5);
  });

  it("returns nulls when no proofs exist", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: null } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: [] } }), { status: 200 })
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
    expect(parsed.hasAgeProof).toBe(false);
    expect(parsed.totalProofs).toBe(0);
  });
});
