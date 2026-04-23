import { describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  config: { zentityUrl: "https://zentity.test" },
}));

vi.mock("../../runtime/dpop-proof.js", () => ({
  createDpopProof: vi.fn().mockResolvedValue("mock-dpop-proof"),
  extractDpopNonce: vi.fn().mockReturnValue(undefined),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function userinfoResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const dpopKey = {
  privateJwk: { kty: "EC", crv: "P-256" },
  publicJwk: { kty: "EC", crv: "P-256" },
};

describe("redeemRelease – address parsing", () => {
  it("parses address as a string", async () => {
    mockFetch.mockResolvedValueOnce(
      userinfoResponse({
        response: {
          name: "Ada Lovelace",
          address: "123 Main St, Anytown, CA 12345",
        },
      })
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims).toEqual({
      name: "Ada Lovelace",
      given_name: undefined,
      family_name: undefined,
      address: "123 Main St, Anytown, CA 12345",
    });
  });

  it("parses address as an OIDC address object", async () => {
    const addressObj = {
      street_address: "123 Main St",
      locality: "Anytown",
      region: "CA",
      postal_code: "12345",
      country: "US",
    };

    mockFetch.mockResolvedValueOnce(
      userinfoResponse({
        response: { name: "Ada Lovelace", address: addressObj },
      })
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims).toEqual({
      name: "Ada Lovelace",
      given_name: undefined,
      family_name: undefined,
      address: addressObj,
    });
  });

  it("returns undefined address when value is null", async () => {
    mockFetch.mockResolvedValueOnce(
      userinfoResponse({
        response: { name: "Ada Lovelace", address: null },
      })
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims).toEqual({
      name: "Ada Lovelace",
      given_name: undefined,
      family_name: undefined,
      address: undefined,
    });
  });

  it("returns undefined address when field is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      userinfoResponse({
        response: { given_name: "Ada", family_name: "Lovelace" },
      })
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims).toEqual({
      name: undefined,
      given_name: "Ada",
      family_name: "Lovelace",
      address: undefined,
    });
  });

  it("returns partial claims when non-name identity fields are present", async () => {
    mockFetch.mockResolvedValueOnce(
      userinfoResponse({
        response: { address: "123 Main St" },
      })
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims).toEqual({
      address: "123 Main St",
    });
  });

  it("returns null on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      userinfoResponse({ error: "unauthorized" }, 401)
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims).toBeNull();
  });

  it("unwraps direct userinfo (no response envelope)", async () => {
    mockFetch.mockResolvedValueOnce(
      userinfoResponse({ name: "Direct User", address: "456 Elm St" })
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims).toEqual({
      name: "Direct User",
      given_name: undefined,
      family_name: undefined,
      address: "456 Elm St",
    });
  });

  it("ignores address when value is an array", async () => {
    mockFetch.mockResolvedValueOnce(
      userinfoResponse({
        response: { name: "Ada Lovelace", address: ["not", "valid"] },
      })
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims?.address).toBeUndefined();
  });

  it("ignores address when value is a number", async () => {
    mockFetch.mockResolvedValueOnce(
      userinfoResponse({
        response: { name: "Ada Lovelace", address: 42 },
      })
    );

    const { redeemRelease } = await import(
      "../../services/identity-release.js"
    );
    const claims = await redeemRelease("tok", dpopKey);

    expect(claims?.address).toBeUndefined();
  });
});
