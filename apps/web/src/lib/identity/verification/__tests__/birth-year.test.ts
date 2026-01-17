import { describe, expect, it } from "vitest";

import { calculateBirthYearOffset, parseBirthYearFromDob } from "../birth-year";

describe("birth-year", () => {
  describe("parseBirthYearFromDob", () => {
    it("parses YYYY-MM-DD", () => {
      expect(parseBirthYearFromDob("1990-05-15")).toBe(1990);
    });

    it("parses DD/MM/YYYY", () => {
      expect(parseBirthYearFromDob("15/05/1990")).toBe(1990);
    });

    it("parses YYYY/MM/DD", () => {
      expect(parseBirthYearFromDob("1990/05/15")).toBe(1990);
    });

    it("returns undefined for unsupported formats", () => {
      expect(parseBirthYearFromDob("1990.05.15")).toBeUndefined();
      expect(parseBirthYearFromDob("")).toBeUndefined();
      expect(parseBirthYearFromDob(undefined)).toBeUndefined();
    });
  });

  describe("calculateBirthYearOffset", () => {
    it("encodes years since 1900", () => {
      expect(calculateBirthYearOffset("1970-01-01")).toBe(70);
      expect(calculateBirthYearOffset("2000-12-31")).toBe(100);
      expect(calculateBirthYearOffset("2001-01-01")).toBe(101);
    });

    it("returns undefined for future birth years", () => {
      const nextYear = new Date().getFullYear() + 1;
      expect(calculateBirthYearOffset(`${nextYear}-01-01`)).toBeUndefined();
    });

    it("returns undefined for pre-1900 birth years", () => {
      expect(calculateBirthYearOffset("1899-12-31")).toBeUndefined();
    });
  });
});
