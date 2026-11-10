import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authGet: vi.fn(),
  authPost: vi.fn(),
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn(() => ({
    GET: mocks.authGet,
    POST: mocks.authPost,
  })),
}));

vi.mock("@/lib/auth/auth-config", () => ({
  auth: {},
}));

vi.mock("@/lib/auth/oidc/wallet-dcr", () => ({
  ensureWalletClientExists: vi.fn(),
}));

vi.mock("@/lib/auth/oidc/haip/resource-metadata", () => ({
  getProtectedResourceMetadataUrl: () =>
    "http://localhost:3000/.well-known/oauth-protected-resource",
}));

vi.mock("@/lib/observability/request-context", () => ({
  attachRequestContextToSpan: vi.fn(),
  resolveRequestContext: vi.fn(() => ({ requestId: "req-1" })),
}));

import { POST } from "./route";

function forwardedRequest(): Request {
  const forwarded = mocks.authPost.mock.calls[0]?.[0];
  if (!(forwarded instanceof Request)) {
    throw new Error("The route did not forward a request");
  }
  return forwarded;
}

describe("POST /api/auth/[...all]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authPost.mockResolvedValue(Response.json({ ok: true }));
  });

  it("forwards an OID4VCI nonce request without its empty body", async () => {
    await POST(
      new Request("http://localhost:3000/api/auth/oidc4vci/nonce", {
        method: "POST",
        headers: { "Content-Length": "0" },
        body: "",
      })
    );

    const forwarded = forwardedRequest();
    expect(forwarded.method).toBe("POST");
    expect(new URL(forwarded.url).pathname).toBe("/api/auth/oidc4vci/nonce");
    expect(forwarded.body).toBeNull();
  });

  it("forwards other requests with their body", async () => {
    await POST(
      new Request("http://localhost:3000/api/auth/oidc4vci/credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential_configuration_id: "identity" }),
      })
    );

    await expect(forwardedRequest().json()).resolves.toEqual({
      credential_configuration_id: "identity",
    });
  });
});
