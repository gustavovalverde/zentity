import { describe, expect, it } from "vitest";

import {
  filterClaimsByRequest,
  parseClaimsParameter,
} from "../claims-parameter";

describe("parseClaimsParameter", () => {
  it("parses valid claims JSON", () => {
    const result = parseClaimsParameter(
      '{"id_token":{"acr":{"essential":true}},"userinfo":{"email":null}}'
    );
    expect(result).toEqual({
      id_token: { acr: { essential: true } },
      userinfo: { email: null },
    });
  });

  it("returns null for empty string", () => {
    expect(parseClaimsParameter("")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseClaimsParameter(42)).toBeNull();
    expect(parseClaimsParameter(null)).toBeNull();
    expect(parseClaimsParameter(undefined)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseClaimsParameter("{bad")).toBeNull();
  });

  it("returns null for JSON with no id_token or userinfo", () => {
    expect(parseClaimsParameter('{"other":"value"}')).toBeNull();
  });
});

describe("filterClaimsByRequest", () => {
  const allClaims = {
    acr: "urn:zentity:assurance:tier2",
    amr: ["passkey"],
    email: "test@example.com",
    name: "Test User",
    at_hash: "abc123",
  };

  it("returns all claims when no request is provided", () => {
    expect(filterClaimsByRequest(allClaims, undefined)).toEqual(allClaims);
  });

  it("filters to only requested claims with null constraints", () => {
    const result = filterClaimsByRequest(allClaims, {
      acr: null,
      email: null,
    });
    expect(result).toEqual({
      acr: "urn:zentity:assurance:tier2",
      email: "test@example.com",
    });
  });

  it("excludes claims that are not present", () => {
    const result = filterClaimsByRequest(allClaims, {
      nonexistent: null,
    });
    expect(result).toEqual({});
  });

  it("respects value constraints", () => {
    const match = filterClaimsByRequest(allClaims, {
      acr: { value: "urn:zentity:assurance:tier2" },
    });
    expect(match).toEqual({ acr: "urn:zentity:assurance:tier2" });

    const noMatch = filterClaimsByRequest(allClaims, {
      acr: { value: "urn:zentity:assurance:tier3" },
    });
    expect(noMatch).toEqual({});
  });

  it("respects values constraints", () => {
    const match = filterClaimsByRequest(allClaims, {
      acr: {
        values: ["urn:zentity:assurance:tier2", "urn:zentity:assurance:tier3"],
      },
    });
    expect(match).toEqual({ acr: "urn:zentity:assurance:tier2" });

    const noMatch = filterClaimsByRequest(allClaims, {
      acr: { values: ["urn:zentity:assurance:tier3"] },
    });
    expect(noMatch).toEqual({});
  });
});
