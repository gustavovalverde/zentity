import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachRequestContextToSpan: vi.fn(),
  authPost: vi.fn(),
  persistOpaqueAccessTokenDpopBinding: vi.fn(),
  resolveRequestContext: vi.fn(() => ({ requestId: "req-1" })),
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn(() => ({
    POST: mocks.authPost,
  })),
}));

vi.mock("@/lib/auth/auth-config", () => ({
  auth: {},
}));

vi.mock("@/lib/auth/oidc/haip/opaque-access-token", () => ({
  persistOpaqueAccessTokenDpopBinding:
    mocks.persistOpaqueAccessTokenDpopBinding,
}));

vi.mock("@/lib/auth/oidc/haip/resource-metadata", () => ({
  getProtectedResourceMetadataUrl: () =>
    "http://localhost:3000/api/auth/.well-known/oauth-authorization-server",
}));

vi.mock("@/lib/observability/request-context", () => ({
  attachRequestContextToSpan: mocks.attachRequestContextToSpan,
  resolveRequestContext: mocks.resolveRequestContext,
}));

import { POST } from "./route";

describe("POST /api/auth/oauth2/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unwraps the Better Auth token response and persists the opaque DPoP binding", async () => {
    mocks.authPost.mockResolvedValue(
      new Response(
        JSON.stringify({
          response: {
            access_token: "opaque-token-1",
            expires_in: 3600,
            token_type: "DPoP",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "dpop-nonce": "nonce-1",
          },
        }
      )
    );

    const request = new Request("http://localhost:3000/api/auth/oauth2/token", {
      method: "POST",
      headers: {
        DPoP: "proof-1",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_token: "opaque-token-1",
      expires_in: 3600,
      token_type: "DPoP",
    });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("dpop-nonce")).toBe("nonce-1");
    expect(mocks.persistOpaqueAccessTokenDpopBinding).toHaveBeenCalledWith(
      "opaque-token-1",
      request
    );
  });

  it("returns unauthorized responses with the protected-resource metadata header", async () => {
    mocks.authPost.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      })
    );

    const response = await POST(
      new Request("http://localhost:3000/api/auth/oauth2/token", {
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3000/api/auth/.well-known/oauth-authorization-server"'
    );
    expect(mocks.persistOpaqueAccessTokenDpopBinding).not.toHaveBeenCalled();
  });
});
