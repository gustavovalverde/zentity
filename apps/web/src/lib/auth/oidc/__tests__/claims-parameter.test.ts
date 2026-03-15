import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeClaimsParameter,
  filterClaimsByRequest,
  findUnsatisfiableEssentialClaim,
  parseClaimsParameter,
  peekClaimsParameter,
  stageClaimsParameter,
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

  it("returns null for non-string", () => {
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

  it("returns all claims when no request", () => {
    expect(filterClaimsByRequest(allClaims, undefined)).toEqual(allClaims);
  });

  it("filters to only requested claims (null constraint)", () => {
    const result = filterClaimsByRequest(allClaims, {
      acr: null,
      email: null,
    });
    expect(result).toEqual({
      acr: "urn:zentity:assurance:tier2",
      email: "test@example.com",
    });
  });

  it("excludes claims not in allClaims", () => {
    const result = filterClaimsByRequest(allClaims, {
      nonexistent: null,
    });
    expect(result).toEqual({});
  });

  it("respects value constraint", () => {
    const result = filterClaimsByRequest(allClaims, {
      acr: { value: "urn:zentity:assurance:tier2" },
    });
    expect(result).toEqual({ acr: "urn:zentity:assurance:tier2" });

    const noMatch = filterClaimsByRequest(allClaims, {
      acr: { value: "urn:zentity:assurance:tier3" },
    });
    expect(noMatch).toEqual({});
  });

  it("respects values constraint", () => {
    const result = filterClaimsByRequest(allClaims, {
      acr: {
        values: ["urn:zentity:assurance:tier2", "urn:zentity:assurance:tier3"],
      },
    });
    expect(result).toEqual({ acr: "urn:zentity:assurance:tier2" });

    const noMatch = filterClaimsByRequest(allClaims, {
      acr: { values: ["urn:zentity:assurance:tier3"] },
    });
    expect(noMatch).toEqual({});
  });
});

describe("findUnsatisfiableEssentialClaim", () => {
  const supported = new Set(["acr", "amr", "email", "name"]);

  it("returns null when all essential claims are supported", () => {
    const result = findUnsatisfiableEssentialClaim(
      { id_token: { acr: { essential: true } } },
      supported
    );
    expect(result).toBeNull();
  });

  it("returns unsatisfiable claim name", () => {
    const result = findUnsatisfiableEssentialClaim(
      { id_token: { unknown_claim: { essential: true } } },
      supported
    );
    expect(result).toBe("unknown_claim");
  });

  it("ignores non-essential claims", () => {
    const result = findUnsatisfiableEssentialClaim(
      { id_token: { unknown_claim: null } },
      supported
    );
    expect(result).toBeNull();
  });
});

describe("stageClaimsParameter / peekClaimsParameter / consumeClaimsParameter", () => {
  beforeEach(() => {
    consumeClaimsParameter("test-user");
  });

  it("stages and peeks without consuming", () => {
    stageClaimsParameter("test-user", {
      id_token: { acr: null },
    });

    const first = peekClaimsParameter("test-user");
    expect(first).toEqual({ id_token: { acr: null } });

    const second = peekClaimsParameter("test-user");
    expect(second).toEqual({ id_token: { acr: null } });
  });

  it("consume removes the entry", () => {
    stageClaimsParameter("test-user", {
      id_token: { acr: null },
    });

    const consumed = consumeClaimsParameter("test-user");
    expect(consumed).toEqual({ id_token: { acr: null } });

    expect(peekClaimsParameter("test-user")).toBeNull();
    expect(consumeClaimsParameter("test-user")).toBeNull();
  });
});
