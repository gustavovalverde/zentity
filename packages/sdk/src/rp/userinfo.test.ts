import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchUserInfo } from "./userinfo.js";

describe("fetchUserInfo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a DPoP client when provided", async () => {
    const proofFor = vi.fn(async () => "dpop-proof");
    const withNonceRetry = async <T,>(
      attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
    ) => attempt("nonce-1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ response: { sub: "user-1" } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    const body = await fetchUserInfo({
      accessToken: "access-token",
      dpopClient: { proofFor, withNonceRetry },
      userInfoUrl: "https://issuer.example/userinfo",
    });

    expect(proofFor).toHaveBeenCalledWith(
      "GET",
      "https://issuer.example/userinfo",
      "access-token",
      "nonce-1"
    );
    expect(fetch).toHaveBeenCalledWith("https://issuer.example/userinfo", {
      headers: {
        Authorization: "DPoP access-token",
        DPoP: "dpop-proof",
      },
    });
    expect(body).toEqual({ sub: "user-1" });
  });

  it("falls back to bearer authorization when no DPoP client is provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ sub: "user-1" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    const body = await fetchUserInfo({
      accessToken: "access-token",
      userInfoUrl: "https://issuer.example/userinfo",
    });

    expect(fetch).toHaveBeenCalledWith("https://issuer.example/userinfo", {
      headers: {
        Authorization: "Bearer access-token",
      },
    });
    expect(body).toEqual({ sub: "user-1" });
  });

  it("returns null when the userinfo request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_token" }), {
        headers: { "content-type": "application/json" },
        status: 401,
      })
    );

    const body = await fetchUserInfo({
      accessToken: "access-token",
      userInfoUrl: "https://issuer.example/userinfo",
    });

    expect(body).toBeNull();
  });
});
