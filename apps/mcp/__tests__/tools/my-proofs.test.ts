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

  it("returns checks from userinfo proof claims for verified user", async () => {
    // Userinfo returns OIDC proof claims (flat key-value, scope-filtered)
    const userinfoResponse = {
      sub: "user-sub",
      verification_level: "full",
      verified: true,
      document_verified: true,
      age_verification: true,
      liveness_verified: true,
      face_match_verified: true,
      nationality_verified: true,
      nationality_group: "GLOBAL",
      identity_bound: true,
      sybil_resistant: true,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(userinfoResponse), { status: 200 })
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
    expect(parsed.checks).toContainEqual({ type: "age", passed: true });
    expect(parsed.checks).toContainEqual({ type: "document", passed: true });
    expect(parsed.checks).toContainEqual({ type: "nationality", passed: true });
  });

  it("returns empty state for unverified user", async () => {
    const userinfoResponse = {
      sub: "user-sub",
      verification_level: "none",
      verified: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(userinfoResponse), { status: 200 })
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
    expect(parsed.verificationLevel).toBe("none");
    expect(parsed.verificationMethod).toBeNull();
    expect(parsed.checks).toHaveLength(0);
  });

  it("does not infer OCR method for unverified users with all-false claims", async () => {
    const userinfoResponse = {
      sub: "user-sub",
      verification_level: "none",
      verified: false,
      document_verified: false,
      age_verification: false,
      liveness_verified: false,
      face_match_verified: false,
      nationality_verified: false,
      identity_bound: false,
      sybil_resistant: false,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(userinfoResponse), { status: 200 })
    );

    const client = await createConnectedClient();
    const result = await client.callTool({
      name: "my_proofs",
      arguments: {},
    });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.verificationMethod).toBeNull();
    expect(parsed.verified).toBe(false);
    expect(parsed.checks.length).toBeGreaterThan(0);
    expect(parsed.checks.every((c: { passed: boolean }) => !c.passed)).toBe(
      true
    );
  });

  it("calls the userinfo endpoint, not tRPC", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sub: "user-sub" }), { status: 200 })
      );

    const client = await createConnectedClient();
    await client.callTool({ name: "my_proofs", arguments: {} });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0]?.[0];
    expect(calledUrl).toContain("/api/auth/oauth2/userinfo");
    expect(calledUrl).not.toContain("/api/trpc/");
  });
});
