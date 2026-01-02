/**
 * Tests for nationality Merkle tree functionality
 */

import { describe, expect, it } from "vitest";

import {
  generateNationalityProofInputs,
  getCountriesInGroup,
  getMerkleRoot,
  getNationalityCode,
  isNationalityInGroup,
  listGroups,
} from "../zk/nationality-merkle";

/** Matches a lowercase hex string with 0x prefix */
const HEX_STRING_PATTERN = /^0x[0-9a-f]+$/;

describe("nationality-merkle", () => {
  describe("listGroups", () => {
    it("should return all country groups", () => {
      const groups = listGroups();
      expect(groups).toContain("EU");
      expect(groups).toContain("EEA");
      expect(groups).toContain("SCHENGEN");
      expect(groups).toContain("LATAM");
      expect(groups).toContain("FIVE_EYES");
    });
  });

  describe("getCountriesInGroup", () => {
    it("should return countries for EU group", () => {
      const countries = getCountriesInGroup("EU");
      expect(countries).toBeDefined();
      expect(countries).toContain("DEU"); // Germany
      expect(countries).toContain("FRA"); // France
      expect(countries).toContain("ESP"); // Spain
      expect(countries?.length).toBe(27);
    });

    it("should return countries for FIVE_EYES group", () => {
      const countries = getCountriesInGroup("FIVE_EYES");
      expect(countries).toEqual(["AUS", "CAN", "NZL", "GBR", "USA"]);
    });

    it("should be case-insensitive", () => {
      expect(getCountriesInGroup("eu")).toEqual(getCountriesInGroup("EU"));
    });

    it("should return undefined for unknown group", () => {
      expect(getCountriesInGroup("UNKNOWN")).toBeUndefined();
    });
  });

  describe("getNationalityCode", () => {
    it("should return numeric code for Germany", () => {
      expect(getNationalityCode("DEU")).toBe(276);
    });

    it("should return numeric code for USA", () => {
      expect(getNationalityCode("USA")).toBe(840);
    });

    it("should be case-insensitive", () => {
      expect(getNationalityCode("deu")).toBe(276);
    });

    it("should return undefined for unknown code", () => {
      expect(getNationalityCode("XYZ")).toBeUndefined();
    });
  });

  describe("isNationalityInGroup", () => {
    it("should return true for Germany in EU", () => {
      expect(isNationalityInGroup("DEU", "EU")).toBe(true);
    });

    it("should return false for USA in EU", () => {
      expect(isNationalityInGroup("USA", "EU")).toBe(false);
    });

    it("should return true for USA in FIVE_EYES", () => {
      expect(isNationalityInGroup("USA", "FIVE_EYES")).toBe(true);
    });

    it("should be case-insensitive", () => {
      expect(isNationalityInGroup("deu", "eu")).toBe(true);
    });
  });

  describe("getMerkleRoot", () => {
    it("should return consistent root for EU group", async () => {
      const root1 = await getMerkleRoot("EU");
      const root2 = await getMerkleRoot("EU");
      expect(root1).toBe(root2);
    });

    it("should return different roots for different groups", async () => {
      const euRoot = await getMerkleRoot("EU");
      const fiveEyesRoot = await getMerkleRoot("FIVE_EYES");
      expect(euRoot).not.toBe(fiveEyesRoot);
    });

    it("should throw for unknown group", async () => {
      await expect(getMerkleRoot("UNKNOWN")).rejects.toThrow(
        "Unknown country group"
      );
    });
  });

  describe("generateNationalityProofInputs", () => {
    it("should generate valid proof inputs for Germany in EU", async () => {
      const inputs = await generateNationalityProofInputs("DEU", "EU");

      expect(inputs.nationalityCodeNumeric).toBe(276);
      expect(inputs.merkleRoot).toMatch(HEX_STRING_PATTERN);
      expect(inputs.pathElements).toHaveLength(8); // TREE_DEPTH = 8
      expect(inputs.pathIndices).toHaveLength(8);

      // Each path element should be a hex string
      for (const elem of inputs.pathElements) {
        expect(elem).toMatch(HEX_STRING_PATTERN);
      }

      // Each path index should be 0 or 1
      for (const idx of inputs.pathIndices) {
        expect(idx === 0 || idx === 1).toBe(true);
      }
    });

    it("should throw for non-member nationality", async () => {
      await expect(generateNationalityProofInputs("USA", "EU")).rejects.toThrow(
        "USA is not a member of EU"
      );
    });

    it("should throw for unknown nationality", async () => {
      await expect(generateNationalityProofInputs("XYZ", "EU")).rejects.toThrow(
        "Unknown nationality code"
      );
    });

    it("should throw for unknown group", async () => {
      await expect(
        generateNationalityProofInputs("DEU", "UNKNOWN")
      ).rejects.toThrow("Unknown country group");
    });

    it("should generate different proofs for different countries in same group", async () => {
      const deuInputs = await generateNationalityProofInputs("DEU", "EU");
      const fraInputs = await generateNationalityProofInputs("FRA", "EU");

      // Same root (same group)
      expect(deuInputs.merkleRoot).toBe(fraInputs.merkleRoot);

      // Different nationality codes
      expect(deuInputs.nationalityCodeNumeric).not.toBe(
        fraInputs.nationalityCodeNumeric
      );

      // Path elements or indices should differ (different leaf positions)
      const pathsDiffer =
        JSON.stringify(deuInputs.pathElements) !==
          JSON.stringify(fraInputs.pathElements) ||
        JSON.stringify(deuInputs.pathIndices) !==
          JSON.stringify(fraInputs.pathIndices);
      expect(pathsDiffer).toBe(true);
    });
  });
});
