import { describe, expect, it } from "vitest";

import {
  calculateBirthYearOffsetFromYear,
  dobToDaysSince1900,
  minAgeYearsToDays,
  parseBirthYearFromDob,
  parseDob,
} from "../birth-year";

describe("birth-year", () => {
  describe("parseDob", () => {
    it("parses YYYY-MM-DD", () => {
      const date = parseDob("1990-05-15");
      expect(date?.toISOString().slice(0, 10)).toBe("1990-05-15");
    });

    it("parses DD/MM/YYYY", () => {
      const date = parseDob("15/05/1990");
      expect(date?.toISOString().slice(0, 10)).toBe("1990-05-15");
    });

    it("rejects invalid calendar dates", () => {
      expect(parseDob("1990-02-30")).toBeUndefined();
      expect(parseDob("1990-13-01")).toBeUndefined();
    });
  });

  describe("dobToDaysSince1900", () => {
    it("encodes 1900-01-01 as day 0", () => {
      expect(dobToDaysSince1900("1900-01-01")).toBe(0);
    });

    it("increments by 1 per day", () => {
      const d0 = dobToDaysSince1900("1900-01-01");
      const d1 = dobToDaysSince1900("1900-01-02");
      expect(d0).toBeDefined();
      expect(d1).toBeDefined();
      expect((d1 ?? 0) - (d0 ?? 0)).toBe(1);
    });

    it("supports pre-1970 dates (e.g., 1950)", () => {
      expect(dobToDaysSince1900("1950-01-01")).toBeTypeOf("number");
    });

    it("returns undefined for pre-1900 dates", () => {
      expect(dobToDaysSince1900("1899-12-31")).toBeUndefined();
    });
  });

  describe("minAgeYearsToDays", () => {
    it("converts years to days using 365.25", () => {
      expect(minAgeYearsToDays(18)).toBe(6574);
      expect(minAgeYearsToDays(0)).toBe(0);
    });
  });

  describe("parseBirthYearFromDob", () => {
    it("extracts year from YYYY-MM-DD", () => {
      expect(parseBirthYearFromDob("1990-05-15")).toBe(1990);
    });

    it("extracts year from DD/MM/YYYY", () => {
      expect(parseBirthYearFromDob("15/05/1990")).toBe(1990);
    });

    it("returns undefined for invalid input", () => {
      expect(parseBirthYearFromDob(undefined)).toBeUndefined();
      expect(parseBirthYearFromDob("")).toBeUndefined();
      expect(parseBirthYearFromDob("invalid")).toBeUndefined();
    });
  });

  describe("calculateBirthYearOffsetFromYear", () => {
    it("calculates offset from 1900", () => {
      expect(calculateBirthYearOffsetFromYear(1990)).toBe(90);
      expect(calculateBirthYearOffsetFromYear(2000)).toBe(100);
    });

    it("returns undefined for null/undefined", () => {
      expect(calculateBirthYearOffsetFromYear(undefined)).toBeUndefined();
      expect(calculateBirthYearOffsetFromYear(null)).toBeUndefined();
    });

    it("returns undefined for out-of-range years", () => {
      expect(calculateBirthYearOffsetFromYear(1899)).toBeUndefined();
      expect(calculateBirthYearOffsetFromYear(2156)).toBeUndefined();
    });
  });
});
