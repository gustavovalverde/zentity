import { describe, expect, it } from "vitest";

import {
  extractIdentityScopes,
  filterIdentityByScopes,
  IDENTITY_SCOPE_CLAIMS,
  IDENTITY_SCOPE_DESCRIPTIONS,
  IDENTITY_SCOPES,
  type IdentityFields,
  isIdentityScope,
} from "../disclosure-registry";

describe("identity scopes", () => {
  describe("isIdentityScope", () => {
    it("returns true for valid identity scopes", () => {
      expect(isIdentityScope("identity.name")).toBe(true);
      expect(isIdentityScope("identity.dob")).toBe(true);
      expect(isIdentityScope("identity.address")).toBe(true);
      expect(isIdentityScope("identity.document")).toBe(true);
      expect(isIdentityScope("identity.nationality")).toBe(true);
    });

    it("returns false for non-identity scopes", () => {
      expect(isIdentityScope("identity")).toBe(false);
      expect(isIdentityScope("openid")).toBe(false);
      expect(isIdentityScope("profile")).toBe(false);
      expect(isIdentityScope("email")).toBe(false);
      expect(isIdentityScope("proof:identity")).toBe(false);
      expect(isIdentityScope("invalid")).toBe(false);
    });
  });

  describe("extractIdentityScopes", () => {
    it("extracts only identity scopes from mixed list", () => {
      const scopes = [
        "openid",
        "profile",
        "identity.name",
        "email",
        "identity.dob",
      ];
      const result = extractIdentityScopes(scopes);
      expect(result).toEqual(["identity.name", "identity.dob"]);
    });

    it("returns empty array when no identity scopes", () => {
      const scopes = ["openid", "profile", "email", "identity"];
      const result = extractIdentityScopes(scopes);
      expect(result).toEqual([]);
    });
  });

  describe("filterIdentityByScopes", () => {
    const fullIdentity: IdentityFields = {
      given_name: "John",
      family_name: "Doe",
      name: "John Doe",
      birthdate: "1990-01-15",
      address: {
        formatted: "123 Main St, City, Country",
        country: "US",
      },
      document_number: "AB123456",
      document_type: "passport",
      issuing_country: "US",
      nationality: "US",
      nationalities: ["US"],
    };

    it("filters to only name fields", () => {
      const filtered = filterIdentityByScopes(fullIdentity, ["identity.name"]);
      expect(filtered).toEqual({
        given_name: "John",
        family_name: "Doe",
        name: "John Doe",
      });
    });

    it("filters to only dob field", () => {
      const filtered = filterIdentityByScopes(fullIdentity, ["identity.dob"]);
      expect(filtered).toEqual({
        birthdate: "1990-01-15",
      });
    });

    it("filters to only address field", () => {
      const filtered = filterIdentityByScopes(fullIdentity, [
        "identity.address",
      ]);
      expect(filtered).toEqual({
        address: {
          formatted: "123 Main St, City, Country",
          country: "US",
        },
      });
    });

    it("filters to only document fields", () => {
      const filtered = filterIdentityByScopes(fullIdentity, [
        "identity.document",
      ]);
      expect(filtered).toEqual({
        document_number: "AB123456",
        document_type: "passport",
        issuing_country: "US",
      });
    });

    it("filters to only nationality fields", () => {
      const filtered = filterIdentityByScopes(fullIdentity, [
        "identity.nationality",
      ]);
      expect(filtered).toEqual({
        nationality: "US",
        nationalities: ["US"],
      });
    });

    it("combines multiple scopes", () => {
      const filtered = filterIdentityByScopes(fullIdentity, [
        "identity.name",
        "identity.dob",
      ]);
      expect(filtered).toEqual({
        given_name: "John",
        family_name: "Doe",
        name: "John Doe",
        birthdate: "1990-01-15",
      });
    });

    it("handles missing fields gracefully", () => {
      const partialIdentity: IdentityFields = {
        given_name: "John",
        // family_name missing
        birthdate: "1990-01-15",
      };
      const filtered = filterIdentityByScopes(partialIdentity, [
        "identity.name",
        "identity.dob",
      ]);
      expect(filtered).toEqual({
        given_name: "John",
        birthdate: "1990-01-15",
      });
    });

    it("returns empty object for non-identity scopes", () => {
      const filtered = filterIdentityByScopes(fullIdentity, [
        "openid",
        "profile",
      ]);
      expect(filtered).toEqual({});
    });
  });

  describe("constants", () => {
    it("IDENTITY_SCOPES contains all expected scopes", () => {
      expect(IDENTITY_SCOPES).toContain("identity.name");
      expect(IDENTITY_SCOPES).toContain("identity.dob");
      expect(IDENTITY_SCOPES).toContain("identity.address");
      expect(IDENTITY_SCOPES).toContain("identity.document");
      expect(IDENTITY_SCOPES).toContain("identity.nationality");
      expect(IDENTITY_SCOPES.length).toBe(5);
    });

    it("IDENTITY_SCOPE_CLAIMS has mappings for all scopes", () => {
      for (const scope of IDENTITY_SCOPES) {
        expect(IDENTITY_SCOPE_CLAIMS[scope]).toBeDefined();
        expect(Array.isArray(IDENTITY_SCOPE_CLAIMS[scope])).toBe(true);
      }
    });

    it("IDENTITY_SCOPE_DESCRIPTIONS has descriptions for all scopes", () => {
      for (const scope of IDENTITY_SCOPES) {
        expect(IDENTITY_SCOPE_DESCRIPTIONS[scope]).toBeDefined();
        expect(typeof IDENTITY_SCOPE_DESCRIPTIONS[scope]).toBe("string");
        expect(IDENTITY_SCOPE_DESCRIPTIONS[scope].length).toBeGreaterThan(10);
      }
    });
  });
});
