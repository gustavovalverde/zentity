import { afterEach, describe, expect, it, vi } from "vitest";
import type { DpopKeyPair } from "../../src/auth/dpop.js";
import { exchangeAuthCode } from "../../src/auth/token-exchange.js";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    port: 3200,
    transport: "stdio",
  },
}));

vi.mock("../../src/auth/credentials.js", () => ({
  updateCredentials: vi.fn(),
}));

vi.mock("../../src/auth/dpop.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-dpop-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

const mockDpopKey: DpopKeyPair = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

describe("Token Exchange", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges auth code for tokens", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at_123",
          token_type: "DPoP",
          expires_in: 3600,
          refresh_token: "rt_456",
          id_token:
            // Minimal JWT: header.payload.signature
            `${btoa(JSON.stringify({ alg: "none" }))}.${btoa(JSON.stringify({ sub: "user-1" }))}.`,
        }),
        { status: 200 }
      )
    );

    const result = await exchangeAuthCode(
      "http://localhost:3000/api/auth/oauth2/token",
      "code_abc",
      "verifier_xyz",
      "client-1",
      "http://127.0.0.1/callback",
      mockDpopKey
    );

    expect(result.accessToken).toBe("at_123");
    expect(result.refreshToken).toBe("rt_456");
    expect(result.loginHint).toBe("user-1");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws on failed token exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("invalid_grant", { status: 400 })
    );

    await expect(
      exchangeAuthCode(
        "http://localhost:3000/api/auth/oauth2/token",
        "bad_code",
        "verifier",
        "client-1",
        "http://127.0.0.1/callback",
        mockDpopKey
      )
    ).rejects.toThrow("Token exchange failed: 400");
  });

  it("retries with DPoP nonce on 400", async () => {
    const { extractDpopNonce } = await import("../../src/auth/dpop.js");
    vi.mocked(extractDpopNonce)
      .mockReturnValueOnce("nonce-1")
      .mockReturnValueOnce("nonce-1");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
          status: 400,
          headers: { "dpop-nonce": "nonce-1" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "at_retry",
            token_type: "DPoP",
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

    const result = await exchangeAuthCode(
      "http://localhost:3000/api/auth/oauth2/token",
      "code_abc",
      "verifier",
      "client-1",
      "http://127.0.0.1/callback",
      mockDpopKey
    );

    expect(result.accessToken).toBe("at_retry");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
