import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockLoadOpaqueAccessToken, mockValidateOpaqueAccessTokenDpop } =
  vi.hoisted(() => ({
    mockLoadOpaqueAccessToken: vi.fn(),
    mockValidateOpaqueAccessTokenDpop: vi.fn(),
  }));

vi.mock("@/lib/auth/oidc/haip/opaque-access-token", () => ({
  loadOpaqueAccessToken: mockLoadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop: mockValidateOpaqueAccessTokenDpop,
}));

vi.mock("../auth-config", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { requireBootstrapAccessToken } from "../resource-auth";

function bootstrapRequest(scheme = "DPoP") {
  return new Request("http://localhost/api/auth/agent/host/register", {
    headers: {
      Authorization: `${scheme} opaque-bootstrap-token`,
      DPoP: "proof",
    },
  });
}

function storedToken(overrides: Record<string, unknown> = {}) {
  return {
    authContextId: null,
    clientId: "pairwise-client",
    dpopJkt: "thumbprint",
    exchangeClaims: { zentity_token_use: "agent_bootstrap" },
    expiresAt: new Date(Date.now() + 60_000),
    referenceId: "jti-1",
    scopes: ["agent:host.register", "agent:session.register"],
    sessionId: null,
    userId: "raw-user-id",
    ...overrides,
  };
}

describe("requireBootstrapAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateOpaqueAccessTokenDpop.mockResolvedValue(true);
  });

  it("resolves a DPoP-bound opaque bootstrap token to its user", async () => {
    mockLoadOpaqueAccessToken.mockResolvedValueOnce(storedToken());

    const result = await requireBootstrapAccessToken(bootstrapRequest(), [
      "agent:host.register",
    ]);

    expect(result).toEqual({
      ok: true,
      principal: {
        kind: "user_access_token",
        userId: "raw-user-id",
        clientId: "pairwise-client",
        scopes: ["agent:host.register", "agent:session.register"],
        token: "opaque-bootstrap-token",
      },
    });
  });

  it.each([
    ["without the bootstrap token use claim", { exchangeClaims: {} }],
    ["without a DPoP binding", { dpopJkt: null }],
    ["after expiry", { expiresAt: new Date(Date.now() - 1000) }],
  ])("rejects tokens %s", async (_label, overrides) => {
    mockLoadOpaqueAccessToken.mockResolvedValueOnce(storedToken(overrides));

    const result = await requireBootstrapAccessToken(bootstrapRequest(), [
      "agent:host.register",
    ]);

    expect(result.ok).toBe(false);
  });

  it("rejects bootstrap tokens presented as Bearer", async () => {
    mockLoadOpaqueAccessToken.mockResolvedValueOnce(storedToken());

    const result = await requireBootstrapAccessToken(
      bootstrapRequest("Bearer"),
      ["agent:host.register"]
    );

    expect(result.ok).toBe(false);
  });
});
