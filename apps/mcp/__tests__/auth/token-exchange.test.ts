import { afterEach, describe, expect, it, vi } from "vitest";
import type { DpopKeyPair } from "../../src/auth/dpop.js";
import {
  exchangeAuthCode,
  exchangeToken,
} from "../../src/auth/token-exchange.js";

vi.mock("../../src/config.js", () => ({
  config: {
    zentityUrl: "http://localhost:3000",
    mcpPublicUrl: "http://localhost:3200",
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
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "user-1@example.com",
            sub: "pairwise-subject",
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
    expect(result.loginHint).toBe("user-1@example.com");
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
    vi.mocked(extractDpopNonce).mockReturnValueOnce("nonce-1");

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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: "user-1@example.com",
            sub: "pairwise-subject",
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
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("exchangeToken (RFC 8693)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const EXCHANGE_PARAMS = {
    tokenEndpoint: "http://localhost:3000/api/auth/oauth2/token",
    subjectToken: "ciba-access-token",
    audience: "https://merchant.example.com",
    clientId: "client-1",
    dpopKey: mockDpopKey,
  };

  it("exchanges an access token for a scoped token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "merchant-token",
          token_type: "DPoP",
          expires_in: 1800,
          scope: "openid purchase",
        }),
        { status: 200 }
      )
    );

    const result = await exchangeToken(EXCHANGE_PARAMS);

    expect(result.accessToken).toBe("merchant-token");
    expect(result.tokenType).toBe("DPoP");
    expect(result.expiresIn).toBe(1800);
    expect(result.scope).toBe("openid purchase");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(EXCHANGE_PARAMS.tokenEndpoint);
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:token-exchange"
    );
    expect(body.get("subject_token")).toBe("ciba-access-token");
    expect(body.get("subject_token_type")).toBe(
      "urn:ietf:params:oauth:token-type:access_token"
    );
    expect(body.get("audience")).toBe("https://merchant.example.com");
  });

  it("includes scope when provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "scoped-token",
          token_type: "DPoP",
        }),
        { status: 200 }
      )
    );

    await exchangeToken({ ...EXCHANGE_PARAMS, scope: "purchase" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("scope")).toBe("purchase");
  });

  it("defaults expiresIn to 3600 when not provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "token",
          token_type: "DPoP",
        }),
        { status: 200 }
      )
    );

    const result = await exchangeToken(EXCHANGE_PARAMS);
    expect(result.expiresIn).toBe(3600);
  });

  it("extracts downstream identity hints from exchanged app tokens", async () => {
    const jwt =
      `${btoa(JSON.stringify({ alg: "none" }))}.` +
      `${btoa(
        JSON.stringify({
          sub: "pairwise-subject",
          zentity_login_hint: "user-123",
        })
      )}.`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: jwt,
          token_type: "DPoP",
        }),
        { status: 200 }
      )
    );

    const result = await exchangeToken(EXCHANGE_PARAMS);

    expect(result.accountSub).toBe("pairwise-subject");
    expect(result.loginHint).toBe("user-123");
  });

  it("throws on failed exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("invalid_grant", { status: 400 })
    );

    await expect(exchangeToken(EXCHANGE_PARAMS)).rejects.toThrow(
      "Token exchange failed: 400"
    );
  });

  it("retries with DPoP nonce on 400", async () => {
    const { extractDpopNonce } = await import("../../src/auth/dpop.js");
    vi.mocked(extractDpopNonce).mockReturnValueOnce("nonce-ex");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
          status: 400,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "retried-token",
            token_type: "DPoP",
          }),
          { status: 200 }
        )
      );

    const result = await exchangeToken(EXCHANGE_PARAMS);
    expect(result.accessToken).toBe("retried-token");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
