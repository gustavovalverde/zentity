import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joseMocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn((url: URL) => `jwks:${url.toString()}`),
  jwtVerify: vi.fn(),
}));

vi.mock("jose", () => joseMocks);

import {
  createJwksTokenVerifier,
  createOpenIdTokenVerifier,
} from "./token-verifier";

function createDiscoveryResponse(cacheControl: string): Response {
  return new Response(
    JSON.stringify({
      issuer: "https://public.zentity.example",
      jwks_uri: "https://issuer.example/api/auth/oauth2/jwks",
    }),
    {
      headers: { "Cache-Control": cacheControl },
      status: 200,
    }
  );
}

describe("token verifiers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates one JWKS per verifier and lets jose cache it for the TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    joseMocks.jwtVerify.mockResolvedValue({ payload: { sub: "user-1" } });

    const verifier = createJwksTokenVerifier({
      issuer: "https://issuer.example",
      jwksTtlMs: 1_000,
      jwksUrl: "https://issuer.example/jwks",
    });

    await verifier.verify("token-a");
    await verifier.verify("token-b");
    await verifier.verify("token-c");

    expect(joseMocks.createRemoteJWKSet).toHaveBeenCalledTimes(1);
    expect(joseMocks.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://issuer.example/jwks"),
      { cacheMaxAge: 1_000 }
    );
    expect(joseMocks.jwtVerify).toHaveBeenNthCalledWith(
      1,
      "token-a",
      "jwks:https://issuer.example/jwks",
      { issuer: "https://issuer.example" }
    );
    expect(joseMocks.jwtVerify).toHaveBeenNthCalledWith(
      3,
      "token-c",
      "jwks:https://issuer.example/jwks",
      { issuer: "https://issuer.example" }
    );
  });

  it("memoizes OpenID discovery metadata using Cache-Control max-age and keeps one JWKS per jwks_uri", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    joseMocks.jwtVerify.mockResolvedValue({ payload: { sub: "user-1" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(createDiscoveryResponse("public, max-age=60"))
    );

    const verifier = createOpenIdTokenVerifier({
      issuerUrl: "https://issuer.example",
    });

    await verifier.verify("token-a", { audience: "client-1" });
    vi.advanceTimersByTime(30_000);
    await verifier.verify("token-b", { audience: "client-1" });
    vi.advanceTimersByTime(31_000);
    await verifier.verify("token-c", { audience: "client-1" });

    expect(fetch).toHaveBeenCalledTimes(2);
    // The refreshed discovery document keeps the same jwks_uri, so the key
    // set (and jose's cache) is reused.
    expect(joseMocks.createRemoteJWKSet).toHaveBeenCalledTimes(1);
    expect(joseMocks.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://issuer.example/api/auth/oauth2/jwks"),
      { cacheMaxAge: 5 * 60 * 1000 }
    );
    expect(joseMocks.jwtVerify).toHaveBeenNthCalledWith(
      1,
      "token-a",
      "jwks:https://issuer.example/api/auth/oauth2/jwks",
      {
        audience: "client-1",
        issuer: "https://public.zentity.example",
      }
    );
  });

  it("does not cache discovery responses marked no-store", async () => {
    joseMocks.jwtVerify.mockResolvedValue({ payload: { sub: "user-1" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(createDiscoveryResponse("no-store"))
    );

    const verifier = createOpenIdTokenVerifier({
      issuerUrl: "https://issuer.example",
    });

    await verifier.verify("token-a");
    await verifier.verify("token-b");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("verifies tokens against discovered issuer metadata", async () => {
    joseMocks.jwtVerify.mockResolvedValue({ payload: { sub: "user-1" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(createDiscoveryResponse("public, max-age=60"))
    );

    const result = await createOpenIdTokenVerifier({
      issuerUrl: "https://issuer.example",
    }).verify("access-token", { audience: "https://rp.example" });

    expect(result).toEqual({ payload: { sub: "user-1" } });
    expect(joseMocks.jwtVerify).toHaveBeenCalledWith(
      "access-token",
      "jwks:https://issuer.example/api/auth/oauth2/jwks",
      {
        audience: "https://rp.example",
        issuer: "https://public.zentity.example",
      }
    );
  });

  it("builds a new JWKS when the discovery document moves jwks_uri", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    joseMocks.jwtVerify.mockResolvedValue({ payload: { sub: "user-1" } });
    const jwksUris = [
      "https://issuer.example/jwks-1",
      "https://issuer.example/jwks-2",
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            issuer: "https://public.zentity.example",
            jwks_uri: jwksUris.shift(),
          }),
          { headers: { "Cache-Control": "max-age=10" }, status: 200 }
        )
      )
    );

    const verifier = createOpenIdTokenVerifier({
      issuerUrl: "https://issuer.example",
    });

    await verifier.verify("token-a");
    vi.advanceTimersByTime(11_000);
    await verifier.verify("token-b");

    expect(joseMocks.createRemoteJWKSet).toHaveBeenCalledTimes(2);
  });
});
