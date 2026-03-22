import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { clearJwksCache, getHardenedJWKSet, validateJwksEndpoint } =
  await import("../jwks-fetcher");

describe("getHardenedJWKSet", () => {
  afterEach(() => {
    clearJwksCache();
  });

  it("returns a function for a valid HTTPS URL", () => {
    const result = getHardenedJWKSet(
      "https://attestation.example.com/.well-known/jwks.json"
    );
    expect(result).toBeTypeOf("function");
  });

  it("returns a function for localhost in dev/test", () => {
    const result = getHardenedJWKSet("http://localhost:3102/api/jwks");
    expect(result).toBeTypeOf("function");
  });

  it("returns null for invalid URL", () => {
    const result = getHardenedJWKSet("not-a-url");
    expect(result).toBeNull();
  });

  it("caches results for the same URL", () => {
    const url = "https://example.com/.well-known/jwks.json";
    const first = getHardenedJWKSet(url);
    const second = getHardenedJWKSet(url);
    expect(first).toBe(second);
  });

  it("returns different instances for different URLs", () => {
    const first = getHardenedJWKSet("https://a.example.com/jwks");
    const second = getHardenedJWKSet("https://b.example.com/jwks");
    expect(first).not.toBe(second);
  });
});

describe("validateJwksEndpoint", () => {
  it("returns false for invalid URL", async () => {
    const result = await validateJwksEndpoint("not-a-url");
    expect(result).toBe(false);
  });

  it("returns false for unreachable URL", async () => {
    const result = await validateJwksEndpoint(
      "http://localhost:19999/nonexistent"
    );
    expect(result).toBe(false);
  });
});
