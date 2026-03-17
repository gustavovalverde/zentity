import { afterEach, describe, expect, it, vi } from "vitest";

const mockAuthContext = {
  accessToken: "test-access-token",
  clientId: "test-client",
  dpopKey: {
    privateJwk: { kty: "EC", crv: "P-256" },
    publicJwk: { kty: "EC", crv: "P-256" },
  },
  loginHint: "user-sub",
};

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-dpop-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../src/auth/context.js", () => ({
  getAuthContext: () => mockAuthContext,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    transport: "stdio",
    zentityUrl: "http://localhost:3000",
    internalServiceToken: "test-service-token-32-chars-min!!",
  },
}));

import { zentityFetch } from "../../src/auth/api-client.js";
import { extractDpopNonce } from "../../src/auth/dpop.js";
import { config } from "../../src/config.js";

describe("zentityFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset transport to stdio between tests
    (config as { transport: string }).transport = "stdio";
  });

  it("sends GET request with DPoP authorization (stdio)", async () => {
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
        }),
      })
    );
  });

  it("retries with new DPoP nonce on 401 (stdio)", async () => {
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

  it("sends POST with JSON body (stdio)", async () => {
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
        }),
        body: JSON.stringify({ data: "value" }),
      })
    );
  });

  describe("HTTP transport (service token)", () => {
    it("sends service token headers instead of Authorization/DPoP", async () => {
      (config as { transport: string }).transport = "http";

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      );

      await zentityFetch("http://localhost:3000/api/test");

      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/test",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-zentity-internal-token": "test-service-token-32-chars-min!!",
            "x-zentity-user-id": "user-sub",
          }),
        })
      );

      // Should NOT have Authorization or DPoP headers
      const callHeaders = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
        ?.headers as Record<string, string>;
      expect(callHeaders.Authorization).toBeUndefined();
      expect(callHeaders.DPoP).toBeUndefined();
    });

    it("sends Content-Type for POST body", async () => {
      (config as { transport: string }).transport = "http";

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("{}", { status: 200 })
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
            "x-zentity-internal-token": "test-service-token-32-chars-min!!",
          }),
          body: JSON.stringify({ data: "value" }),
        })
      );
    });

    it("throws when INTERNAL_SERVICE_TOKEN is missing", async () => {
      (config as { transport: string }).transport = "http";
      const original = config.internalServiceToken;
      (
        config as { internalServiceToken: string | undefined }
      ).internalServiceToken = undefined;

      await expect(
        zentityFetch("http://localhost:3000/api/test")
      ).rejects.toThrow("INTERNAL_SERVICE_TOKEN");

      (
        config as { internalServiceToken: string | undefined }
      ).internalServiceToken = original;
    });
  });
});
