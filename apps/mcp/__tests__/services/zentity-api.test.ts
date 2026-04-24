import { afterEach, describe, expect, it, vi } from "vitest";

const mockOAuthContext = {
  accessToken: "test-access-token",
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

vi.mock("../../src/runtime/dpop-proof.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-dpop-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../src/runtime/auth-context.js", () => ({
  getAuthContext: () => mockAuthContext,
  getOAuthContext: () => mockOAuthContext,
}));

import { extractDpopNonce } from "../../src/runtime/dpop-proof.js";
import { zentityFetch } from "../../src/services/zentity-api.js";

describe("zentityFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends GET request with DPoP authorization", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const response = await zentityFetch("http://localhost:3000/api/test");

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/test",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "DPoP test-access-token",
          DPoP: "mock-dpop-proof",
        }),
      })
    );
  });

  it("retries with new DPoP nonce on 401", async () => {
    (extractDpopNonce as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce("new-nonce")
      .mockReturnValueOnce("new-nonce");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

    const response = await zentityFetch("http://localhost:3000/api/test");

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends POST with JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ created: true }), { status: 201 })
    );

    await zentityFetch("http://localhost:3000/api/test", {
      method: "POST",
      body: JSON.stringify({ data: "value" }),
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/test",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "DPoP test-access-token",
          DPoP: "mock-dpop-proof",
        }),
        body: JSON.stringify({ data: "value" }),
      })
    );
  });
});
