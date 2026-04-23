import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiscoveryResolver } from "./discovery";

const BASE_DOCUMENT = {
  issuer: "https://issuer.example",
  token_endpoint: "https://issuer.example/oauth/token",
  authorization_endpoint: "https://issuer.example/oauth/authorize",
};

describe("createDiscoveryResolver", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("caches discovery until cache-control max-age expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T19:10:00.000Z"));

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(BASE_DOCUMENT), {
          headers: { "cache-control": "max-age=60" },
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...BASE_DOCUMENT,
            jwks_uri: "https://issuer.example/jwks.json",
          }),
          {
            headers: { "cache-control": "max-age=60" },
            status: 200,
          }
        )
      );

    const resolver = createDiscoveryResolver({
      issuerUrl: "https://issuer.example",
    });

    expect(await resolver.read()).toEqual(BASE_DOCUMENT);
    expect(await resolver.read()).toEqual(BASE_DOCUMENT);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(resolver.peek()).toEqual(BASE_DOCUMENT);

    vi.advanceTimersByTime(61_000);

    expect(await resolver.read()).toEqual({
      ...BASE_DOCUMENT,
      jwks_uri: "https://issuer.example/jwks.json",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not cache discovery when cache-control is no-store", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(BASE_DOCUMENT), {
          headers: { "cache-control": "no-store" },
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(BASE_DOCUMENT), {
          headers: { "cache-control": "no-store" },
          status: 200,
        })
      );

    const resolver = createDiscoveryResolver({
      issuerUrl: "https://issuer.example",
    });

    await resolver.read();
    await resolver.read();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(resolver.peek()).toBeUndefined();
  });

  it("clears the cached discovery document explicitly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(BASE_DOCUMENT), {
        headers: { "cache-control": "max-age=60" },
        status: 200,
      })
    );

    const resolver = createDiscoveryResolver({
      issuerUrl: "https://issuer.example",
    });

    await resolver.read();
    expect(resolver.peek()).toEqual(BASE_DOCUMENT);

    resolver.clear();

    expect(resolver.peek()).toBeUndefined();
  });
});
