import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authGet: vi.fn(),
  authPost: vi.fn(),
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn(() => ({ GET: mocks.authGet, POST: mocks.authPost })),
}));

vi.mock("@/lib/auth/auth-config", () => ({ auth: {} }));

vi.mock("@/lib/auth/oidc/wallet-dcr", () => ({
  ensureWalletClientExists: vi.fn(),
}));

import { GET, POST } from "./route";

const AUTH_URL = "http://localhost:3000/api/auth";
const RESOURCE_METADATA_URL =
  "http://localhost:3000/.well-known/oauth-protected-resource";

function challengeResponse(status: number, challenge: string): Response {
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": challenge,
    },
  });
}

describe("Better Auth catch-all route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the UserInfo DPoP challenge from the provider", async () => {
    const challenge =
      'DPoP error="use_dpop_nonce", error_description="DPoP proof must include a server-provided nonce", algs="ES256"';
    mocks.authGet.mockResolvedValue(challengeResponse(401, challenge));

    const response = await GET(
      new Request(`${AUTH_URL}/oauth2/userinfo`, {
        headers: { Authorization: "DPoP token", DPoP: "proof" },
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(challenge);
  });

  it("keeps the Basic challenge on a token endpoint invalid_client", async () => {
    mocks.authPost.mockResolvedValue(challengeResponse(401, "Basic"));

    const response = await POST(
      new Request(`${AUTH_URL}/oauth2/token`, { method: "POST" })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Basic");
  });

  it("challenges a revoked token refused at UserInfo", async () => {
    mocks.authGet.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_token",
          error_description: "access token revoked",
        }),
        { status: 401 }
      )
    );

    const response = await GET(
      new Request(`${AUTH_URL}/oauth2/userinfo`, {
        headers: { Authorization: "Bearer revoked-token" },
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer error="invalid_token", error_description="access token revoked", resource_metadata="${RESOURCE_METADATA_URL}"`
    );
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_token",
    });
  });

  it("answers a DPoP-scheme request refused at UserInfo in the DPoP scheme", async () => {
    mocks.authPost.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_token",
          error_description: "release_context_missing",
        }),
        { status: 401 }
      )
    );

    const response = await POST(
      new Request(`${AUTH_URL}/oauth2/userinfo`, {
        method: "POST",
        headers: { Authorization: "DPoP token", DPoP: "proof" },
      })
    );

    expect(response.headers.get("WWW-Authenticate")).toBe(
      'DPoP error="invalid_token", error_description="release_context_missing", algs="ES256"'
    );
  });

  it("points a UserInfo request without a token at the resource metadata", async () => {
    mocks.authGet.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_request",
          error_description: "access token not found",
        }),
        { status: 401 }
      )
    );

    const response = await GET(new Request(`${AUTH_URL}/oauth2/userinfo`));

    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`
    );
  });

  it("leaves a 401 from another endpoint unchanged", async () => {
    mocks.authPost.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 })
    );

    const response = await POST(
      new Request(`${AUTH_URL}/oauth2/token`, { method: "POST" })
    );

    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });
});
