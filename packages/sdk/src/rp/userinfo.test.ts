import { afterEach, describe, expect, it, vi } from "vitest";

import type { DpopRequestInit } from "./dpop-client";
import { fetchUserInfo } from "./userinfo";

describe("fetchUserInfo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a DPoP client when provided", async () => {
    const dpopFetch = vi.fn(
      async (_url: string | URL, _init?: DpopRequestInit) =>
        new Response(JSON.stringify({ response: { sub: "user-1" } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })
    );

    const body = await fetchUserInfo({
      accessToken: "access-token",
      dpopClient: { fetch: dpopFetch },
      userInfoUrl: "https://issuer.example/userinfo",
    });

    expect(dpopFetch).toHaveBeenCalledWith("https://issuer.example/userinfo", {
      accessToken: "access-token",
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
