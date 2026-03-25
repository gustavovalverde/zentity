import type { AccountTier } from "../types";

import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACR_VALUES_SUPPORTED,
  buildOidcAssuranceClaims,
  computeAtHash,
  loginMethodToAmr,
} from "../oidc-claims";

describe("buildOidcAssuranceClaims", () => {
  it.each([
    [0, "urn:zentity:assurance:tier-0"],
    [1, "urn:zentity:assurance:tier-1"],
    [2, "urn:zentity:assurance:tier-2"],
    [3, "urn:zentity:assurance:tier-3"],
  ] as [AccountTier, string][])("maps tier %d to %s", (tier, expectedUri) => {
    expect(
      buildOidcAssuranceClaims(
        { tier },
        { amr: ["pwd"], authenticatedAt: 1_700_000_000 }
      ).acr
    ).toBe(expectedUri);
  });

  it("ACR_VALUES_SUPPORTED contains all tier URIs", () => {
    expect(ACR_VALUES_SUPPORTED).toHaveLength(4);
    for (const tier of [0, 1, 2, 3] as AccountTier[]) {
      expect(ACR_VALUES_SUPPORTED).toContain(
        buildOidcAssuranceClaims(
          { tier },
          { amr: ["pwd"], authenticatedAt: 1_700_000_000 }
        ).acr
      );
    }
  });

  it.each([
    [0, "http://eidas.europa.eu/LoA/low"],
    [1, "http://eidas.europa.eu/LoA/low"],
    [2, "http://eidas.europa.eu/LoA/substantial"],
    [3, "http://eidas.europa.eu/LoA/high"],
  ] as [
    AccountTier,
    string,
  ][])("maps tier %d to %s for acr_eidas", (tier, expectedUri) => {
    expect(
      buildOidcAssuranceClaims(
        { tier },
        { amr: ["pwd"], authenticatedAt: 1_700_000_000 }
      ).acr_eidas
    ).toBe(expectedUri);
  });

  it("omits amr when the auth method cannot be normalized", () => {
    expect(
      buildOidcAssuranceClaims(
        { tier: 1 },
        { amr: [], authenticatedAt: 1_700_000_000 }
      )
    ).toEqual({
      acr: "urn:zentity:assurance:tier-1",
      acr_eidas: "http://eidas.europa.eu/LoA/low",
      auth_time: 1_700_000_000,
    });
  });
});

describe("loginMethodToAmr", () => {
  it("maps passkey to pop + hwk + user", () => {
    expect(loginMethodToAmr("passkey")).toEqual(["pop", "hwk", "user"]);
  });

  it("maps opaque to pwd", () => {
    expect(loginMethodToAmr("opaque")).toEqual(["pwd"]);
  });

  it("maps magic-link to otp", () => {
    expect(loginMethodToAmr("magic-link")).toEqual(["otp"]);
  });

  it("maps oauth to an empty AMR set", () => {
    expect(loginMethodToAmr("oauth")).toEqual([]);
  });

  it("maps eip712 to pop + hwk", () => {
    expect(loginMethodToAmr("eip712")).toEqual(["pop", "hwk"]);
  });

  it("maps credential to pwd", () => {
    expect(loginMethodToAmr("credential")).toEqual(["pwd"]);
  });

  it("falls back to user for null", () => {
    expect(loginMethodToAmr(null)).toEqual(["user"]);
  });

  it("falls back to user for undefined", () => {
    expect(loginMethodToAmr(undefined)).toEqual(["user"]);
  });

  it("falls back to user for unknown method", () => {
    expect(loginMethodToAmr("none")).toEqual(["user"]);
  });
});

describe("computeAtHash", () => {
  const testToken = "ya29.test-access-token-value";

  it("returns base64url left-half SHA-256 for RS256", () => {
    const result = computeAtHash(testToken, "RS256");
    // Manually compute expected: SHA-256 → left 16 bytes → base64url
    const hash = crypto
      .createHash("sha256")
      .update(testToken, "ascii")
      .digest();
    const expected = hash.subarray(0, 16).toString("base64url");
    expect(result).toBe(expected);
  });

  it("returns base64url left-half SHA-256 for ES256", () => {
    const result = computeAtHash(testToken, "ES256");
    const hash = crypto
      .createHash("sha256")
      .update(testToken, "ascii")
      .digest();
    const expected = hash.subarray(0, 16).toString("base64url");
    expect(result).toBe(expected);
  });

  it("returns base64url left-half SHA-512 for EdDSA", () => {
    const result = computeAtHash(testToken, "EdDSA");
    const hash = crypto
      .createHash("sha512")
      .update(testToken, "ascii")
      .digest();
    const expected = hash.subarray(0, 32).toString("base64url");
    expect(result).toBe(expected);
  });

  it("returns base64url left-half SHA-256 for ML-DSA-65", () => {
    const result = computeAtHash(testToken, "ML-DSA-65");
    const hash = crypto
      .createHash("sha256")
      .update(testToken, "ascii")
      .digest();
    const expected = hash.subarray(0, 16).toString("base64url");
    expect(result).toBe(expected);
  });

  it("returns undefined for unknown algorithm", () => {
    expect(computeAtHash(testToken, "none")).toBeUndefined();
    expect(computeAtHash(testToken, "HS256")).toBeUndefined();
  });

  it("RS256 and ES256 produce identical hashes (same algorithm)", () => {
    expect(computeAtHash(testToken, "RS256")).toBe(
      computeAtHash(testToken, "ES256")
    );
  });

  it("different tokens produce different hashes", () => {
    const hash1 = computeAtHash("token-a", "RS256");
    const hash2 = computeAtHash("token-b", "RS256");
    expect(hash1).not.toBe(hash2);
  });
});
