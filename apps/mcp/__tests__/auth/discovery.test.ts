import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoveryCache,
  discover,
  getDiscoveredJwksUri,
} from "../../src/auth/discovery.js";

describe("OAuth Discovery", () => {
  afterEach(() => {
    clearDiscoveryCache();
    vi.restoreAllMocks();
  });

  it("fetches and parses discovery metadata", async () => {
    const metadata = {
      issuer: "http://localhost:3000/api/auth",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      registration_endpoint: "http://localhost:3000/api/auth/oauth2/register",
      authorization_challenge_endpoint:
        "http://localhost:3000/api/oauth2/authorize-challenge",
      backchannel_authentication_endpoint:
        "http://localhost:3000/api/auth/oauth2/bc-authorize",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(metadata), { status: 200 })
    );

    const state = await discover("http://localhost:3000");
    expect(state.issuer).toBe(metadata.issuer);
    expect(state.token_endpoint).toBe(metadata.token_endpoint);
    expect(state.registration_endpoint).toBe(metadata.registration_endpoint);
    expect(state.authorization_challenge_endpoint).toBe(
      metadata.authorization_challenge_endpoint
    );
    expect(state.backchannel_authentication_endpoint).toBe(
      metadata.backchannel_authentication_endpoint
    );
  });

  it("caches the discovery result", async () => {
    const metadata = {
      issuer: "http://localhost:3000/api/auth",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
    };

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(metadata), { status: 200 })
      );

    await discover("http://localhost:3000");
    await discover("http://localhost:3000");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws on non-200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404, statusText: "Not Found" })
    );

    await expect(discover("http://localhost:3000")).rejects.toThrow(
      "Discovery failed: 404"
    );
  });

  it("throws on invalid metadata (missing required fields)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ issuer: "x" }), { status: 200 })
    );

    await expect(discover("http://localhost:3000")).rejects.toThrow();
  });

  it("exposes jwks_uri from discovery", async () => {
    const metadata = {
      issuer: "http://localhost:3000/api/auth",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      jwks_uri: "http://localhost:3000/api/auth/jwks",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(metadata), { status: 200 })
    );

    await discover("http://localhost:3000");
    expect(getDiscoveredJwksUri()).toBe(metadata.jwks_uri);
  });
});
