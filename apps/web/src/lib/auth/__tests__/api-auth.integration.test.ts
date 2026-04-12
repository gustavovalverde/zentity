import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  mockCreateDpopAccessTokenValidator,
  mockExtractAccessToken,
  mockValidateOAuthAccessToken,
  mockResolveUserIdFromSub,
  mockVerifyAccessToken,
  mockVerifyAuthIssuedJwt,
} = vi.hoisted(() => ({
  mockCreateDpopAccessTokenValidator: vi.fn(() => vi.fn()),
  mockExtractAccessToken: vi.fn(),
  mockValidateOAuthAccessToken: vi.fn(),
  mockResolveUserIdFromSub: vi.fn(),
  mockVerifyAccessToken: vi.fn(),
  mockVerifyAuthIssuedJwt: vi.fn(),
}));

vi.mock("@better-auth/haip", () => ({
  createDpopAccessTokenValidator: mockCreateDpopAccessTokenValidator,
}));

vi.mock("@/lib/auth/oidc/oauth-token-validation", () => ({
  extractAccessToken: mockExtractAccessToken,
  validateOAuthAccessToken: mockValidateOAuthAccessToken,
}));

vi.mock("@/lib/auth/oidc/pairwise", () => ({
  resolveUserIdFromSub: mockResolveUserIdFromSub,
}));

vi.mock("@/lib/db/connection", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@/lib/trpc/jwt-session", () => ({
  verifyAccessToken: mockVerifyAccessToken,
  verifyAuthIssuedJwt: mockVerifyAuthIssuedJwt,
}));

vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { requireBootstrapAccessToken } from "../api-auth";

describe("requireBootstrapAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps pairwise bootstrap JWT subjects back to raw user ids", async () => {
    const dpopValidator = vi.fn(async () => undefined);
    mockCreateDpopAccessTokenValidator.mockReturnValueOnce(dpopValidator);
    mockVerifyAuthIssuedJwt.mockResolvedValueOnce({
      aud: "http://localhost:3000",
      azp: "pairwise-client",
      cnf: { jkt: "thumbprint" },
      scope: "agent:host.register agent:session.register",
      sub: "pairwise-subject",
      zentity_token_use: "agent_bootstrap",
    });
    mockResolveUserIdFromSub.mockResolvedValueOnce("raw-user-id");

    const request = new Request(
      "http://localhost/api/auth/agent/register-host",
      {
        headers: {
          Authorization: "DPoP eyJ.bootstrap-token",
          DPoP: "proof",
        },
      }
    );

    const result = await requireBootstrapAccessToken(request, [
      "agent:host.register",
    ]);

    expect(result).toEqual({
      ok: true,
      principal: {
        kind: "user_access_token",
        userId: "raw-user-id",
        clientId: "pairwise-client",
        scopes: ["agent:host.register", "agent:session.register"],
        token: "eyJ.bootstrap-token",
      },
    });
  });

  it("rejects tokens without the bootstrap token use claim", async () => {
    const dpopValidator = vi.fn(async () => undefined);
    mockCreateDpopAccessTokenValidator.mockReturnValueOnce(dpopValidator);
    mockVerifyAuthIssuedJwt.mockResolvedValueOnce({
      aud: "http://localhost:3000",
      azp: "pairwise-client",
      cnf: { jkt: "thumbprint" },
      scope: "agent:host.register agent:session.register",
      sub: "pairwise-subject",
    });

    const request = new Request(
      "http://localhost/api/auth/agent/register-host",
      {
        headers: {
          Authorization: "DPoP eyJ.bootstrap-token",
          DPoP: "proof",
        },
      }
    );

    const result = await requireBootstrapAccessToken(request, [
      "agent:host.register",
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected bootstrap access token validation to fail");
    }
    expect(result.response.status).toBe(401);
  });
});
