import { describe, expect, it } from "vitest";

import {
  calculateBirthYearOffsetFromYear,
  dobDaysToBirthYearOffset,
  dobToDaysSince1900,
  minAgeYearsToDays,
  parseBirthYearFromDob,
} from "../birth-year";

describe("birth-year", () => {
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

  describe("dobDaysToBirthYearOffset", () => {
    it("converts dobDays to birth year offset", () => {
      const dob1990 = dobToDaysSince1900("1990-01-01") ?? 0;
      expect(dobDaysToBirthYearOffset(dob1990)).toBe(90);

      const dob2000 = dobToDaysSince1900("2000-06-15") ?? 0;
      expect(dobDaysToBirthYearOffset(dob2000)).toBe(100);
    });

    it("returns null for null/undefined", () => {
      expect(dobDaysToBirthYearOffset(null)).toBeNull();
      expect(dobDaysToBirthYearOffset(undefined)).toBeNull();
    });

    it("round-trips with dobToDaysSince1900 + calculateBirthYearOffsetFromYear", () => {
      const dob = "1985-03-20";
      const dobDays = dobToDaysSince1900(dob) ?? 0;
      const offset = dobDaysToBirthYearOffset(dobDays);
      const birthYear = parseBirthYearFromDob(dob) ?? 0;
      const expectedOffset = calculateBirthYearOffsetFromYear(birthYear);
      expect(offset).toBe(expectedOffset);
    });
  });
});
