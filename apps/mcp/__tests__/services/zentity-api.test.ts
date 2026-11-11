import { beforeEach, describe, expect, it, vi } from "vitest";

const dpopFetch = vi.fn();

const mockOAuthContext = {
  accessToken: "test-access-token",
  clientId: "test-client",
  dpopClient: { fetch: dpopFetch },
  dpopKey: {
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  },
};

const mockAuthContext = {
  oauth: mockOAuthContext,
};

vi.mock("../../src/runtime/auth-context.js", () => ({
  getAuthContext: () => mockAuthContext,
  getOAuthContext: () => mockOAuthContext,
}));

import { zentityFetch } from "../../src/services/zentity-api.js";

describe("zentityFetch", () => {
  beforeEach(() => {
    dpopFetch.mockReset();
    dpopFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
  });

  it("sends a GET request through the DPoP client with the access token", async () => {
    const response = await zentityFetch("http://localhost:3000/api/test");

    expect(response.ok).toBe(true);
    expect(dpopFetch).toHaveBeenCalledWith("http://localhost:3000/api/test", {
      method: "GET",
      accessToken: "test-access-token",
    });
  });

  it("sends POST with JSON body", async () => {
    await zentityFetch("http://localhost:3000/api/test", {
      method: "POST",
      body: JSON.stringify({ data: "value" }),
    });

    expect(dpopFetch).toHaveBeenCalledWith("http://localhost:3000/api/test", {
      method: "POST",
      accessToken: "test-access-token",
      body: JSON.stringify({ data: "value" }),
      headers: { "Content-Type": "application/json" },
    });
  });
});
