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

const { mockGetIdentityResolution } = vi.hoisted(() => ({
  mockGetIdentityResolution: vi.fn(),
}));

vi.mock("../../src/auth/identity.js", () => ({
  getIdentityResolution: mockGetIdentityResolution,
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server/index.js";

describe("whoami", () => {
  beforeEach(() => {
    mockGetIdentityResolution.mockReset();
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

  it("returns identity with name when cached", async () => {
    mockGetIdentityResolution.mockResolvedValue({
      status: "ready",
      claims: {
        name: "Gustavo Alberto Valverde",
        given_name: "Gustavo Alberto",
        family_name: "Valverde",
      },
    });

    const profileData = {
      tier: 3,
      tierName: "Chip Verified",
      authStrength: "strong",
      loginMethod: "passkey",
      details: { documentVerified: true },
    };
    const accountData = {
      email: "user@example.com",
      createdAt: "2026-01-01",
      verification: { level: "chip", checks: { document: true } },
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: profileData } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: accountData } }), {
          status: 200,
        })
      );

    const client = await createConnectedClient();
    const result = await client.callTool({ name: "whoami", arguments: {} });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.first_name).toBe("Gustavo");
    expect(parsed.given_name).toBe("Gustavo Alberto");
    expect(parsed.family_name).toBe("Valverde");
    expect(parsed.email).toBe("user@example.com");
    expect(parsed.tier).toBe(3);
    expect(parsed.identityStatus).toBe("ready");
  });

  it("derives first_name from name when given_name is absent (ZKPassport)", async () => {
    mockGetIdentityResolution.mockResolvedValue({
      status: "ready",
      claims: {
        name: "Gustavo A Jr Valverde De Soto",
      },
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Error", { status: 500 }))
      .mockResolvedValueOnce(new Response("Error", { status: 500 }));

    const client = await createConnectedClient();
    const result = await client.callTool({ name: "whoami", arguments: {} });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.first_name).toBe("Gustavo");
    expect(parsed.name).toBe("Gustavo A Jr Valverde De Soto");
    expect(parsed.given_name).toBeNull();
    expect(parsed.family_name).toBeNull();
  });

  it("triggers CIBA when identity not cached", async () => {
    mockGetIdentityResolution.mockResolvedValue({
      status: "ready",
      claims: {
        name: "Jane Doe",
        given_name: "Jane",
      },
    });

    const profileData = {
      tier: 2,
      tierName: "Verified",
      authStrength: "strong",
      loginMethod: "passkey",
      details: {},
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: profileData } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response("Error", { status: 500 }));

    const client = await createConnectedClient();
    const result = await client.callTool({ name: "whoami", arguments: {} });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.given_name).toBe("Jane");
    expect(parsed.tier).toBe(2);
    expect(parsed.identityStatus).toBe("ready");
  });

  it("continues without name when CIBA is denied", async () => {
    mockGetIdentityResolution.mockResolvedValue({
      status: "denied",
      message: "Identity unlock was denied: User denied",
    });

    const profileData = {
      tier: 1,
      tierName: "Account",
      authStrength: "basic",
      loginMethod: "opaque",
      details: {},
    };
    const accountData = {
      email: "user@example.com",
      createdAt: "2026-01-01",
      verification: { level: "none", checks: {} },
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: profileData } }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { data: accountData } }), {
          status: 200,
        })
      );

    const client = await createConnectedClient();
    const result = await client.callTool({ name: "whoami", arguments: {} });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.name).toBeNull();
    expect(parsed.email).toBe("user@example.com");
    expect(parsed.tier).toBe(1);
    expect(parsed.identityStatus).toBe("denied");
    expect(result.isError).toBeUndefined();
  });

  it("returns approval metadata instead of hanging when identity unlock is pending", async () => {
    mockGetIdentityResolution.mockResolvedValue({
      status: "approval_required",
      approval: {
        approvalUrl: "http://localhost:3000/approve/req-abc?source=cli_handoff",
        authReqId: "req-abc",
        expiresIn: 300,
        intervalSeconds: 5,
      },
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Error", { status: 500 }))
      .mockResolvedValueOnce(new Response("Error", { status: 500 }));

    const client = await createConnectedClient();
    const result = await client.callTool({ name: "whoami", arguments: {} });

    const parsed = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text
    );
    expect(parsed.name).toBeNull();
    expect(parsed.identityStatus).toBe("approval_required");
    expect(parsed.identityApproval).toEqual({
      approvalUrl: "http://localhost:3000/approve/req-abc?source=cli_handoff",
      authReqId: "req-abc",
      expiresIn: 300,
      intervalSeconds: 5,
      message: "Approve the identity unlock and call whoami again.",
    });
  });
});
