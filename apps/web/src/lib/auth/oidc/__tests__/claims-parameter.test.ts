import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consumeIdTokenClaims,
  consumeUserinfoClaims,
  filterClaimsByRequest,
  findUnsatisfiableEssentialClaim,
  parseClaimsParameter,
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

describe("claims parameter lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("consumeIdTokenClaims returns and removes id_token portion only", () => {
    stageClaimsParameter("test-user", "client-a", {
      id_token: { acr: null },
      userinfo: { email: null },
    });

    const idToken = consumeIdTokenClaims("test-user");
    expect(idToken).toEqual({ acr: null });

    // userinfo portion still available
    const userinfo = consumeUserinfoClaims("test-user");
    expect(userinfo).toEqual({ email: null });
  });

  it("consumeUserinfoClaims returns and removes entire entry", () => {
    stageClaimsParameter("test-user", "client-a", {
      id_token: { acr: null },
      userinfo: { email: null },
    });

    const userinfo = consumeUserinfoClaims("test-user");
    expect(userinfo).toEqual({ email: null });

    // everything gone
    expect(consumeIdTokenClaims("test-user")).toBeUndefined();
    expect(consumeUserinfoClaims("test-user")).toBeUndefined();
  });

  it("returns undefined for non-existent user", () => {
    expect(consumeIdTokenClaims("unknown")).toBeUndefined();
    expect(consumeUserinfoClaims("unknown")).toBeUndefined();
  });

  it("expires entries after TTL", () => {
    stageClaimsParameter("test-user", "client-a", {
      id_token: { acr: null },
    });

    // Advance time past 5-minute TTL
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 6 * 60 * 1000);

    expect(consumeIdTokenClaims("test-user")).toBeUndefined();
  });

  it("second stage for same user+client replaces the first", () => {
    stageClaimsParameter("test-user", "client-a", {
      id_token: { acr: null },
    });
    stageClaimsParameter("test-user", "client-a", {
      id_token: { email: null },
    });

    const idToken = consumeIdTokenClaims("test-user");
    expect(idToken).toEqual({ email: null });
  });

  it("different clients for same user are independent", () => {
    stageClaimsParameter("test-user", "client-a", {
      id_token: { acr: null },
    });
    stageClaimsParameter("test-user", "client-b", {
      id_token: { email: null },
    });

    const a = consumeIdTokenClaims("test-user", "client-a");
    expect(a).toEqual({ acr: null });

    const b = consumeIdTokenClaims("test-user", "client-b");
    expect(b).toEqual({ email: null });
  });

  it("prefix-scan fails when multiple clients exist (no clientId)", () => {
    stageClaimsParameter("test-user", "client-a", {
      id_token: { acr: null },
    });
    stageClaimsParameter("test-user", "client-b", {
      id_token: { email: null },
    });

    // Without clientId, prefix-scan finds 2 matches → returns undefined
    expect(consumeIdTokenClaims("test-user")).toBeUndefined();
  });

  it("deletes entry when only id_token is present and consumed", () => {
    stageClaimsParameter("test-user", "client-a", {
      id_token: { acr: null },
    });

    consumeIdTokenClaims("test-user");
    // No userinfo → entry deleted
    expect(consumeUserinfoClaims("test-user")).toBeUndefined();
  });

  it("consumeIdTokenClaims with explicit clientId finds exact match", () => {
    stageClaimsParameter("u1", "c1", {
      id_token: { acr: null },
    });

    expect(consumeIdTokenClaims("u1", "c1")).toEqual({ acr: null });
    expect(consumeIdTokenClaims("u1", "c2")).toBeUndefined();
  });

  it("consumeUserinfoClaims with explicit clientId finds exact match", () => {
    stageClaimsParameter("u1", "c1", {
      id_token: { acr: null },
      userinfo: { email: null },
    });

    expect(consumeUserinfoClaims("u1", "c1")).toEqual({ email: null });
    expect(consumeUserinfoClaims("u1", "c2")).toBeUndefined();
  });

  it("concurrent entries for different clients are disambiguated when clientId is provided", () => {
    stageClaimsParameter("u1", "c1", {
      id_token: { claim_a: null },
    });
    stageClaimsParameter("u1", "c2", {
      id_token: { claim_b: null },
    });

    // Without clientId: ambiguous → undefined
    expect(consumeIdTokenClaims("u1")).toBeUndefined();

    // With clientId: exact match
    expect(consumeIdTokenClaims("u1", "c1")).toEqual({ claim_a: null });
    expect(consumeIdTokenClaims("u1", "c2")).toEqual({ claim_b: null });
  });
});
