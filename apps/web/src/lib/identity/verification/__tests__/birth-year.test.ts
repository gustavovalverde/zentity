import { describe, expect, it } from "vitest";

import {
  calculateBirthYearOffsetFromYear,
  dobDaysToBirthYearOffset,
  dobToDaysSince1900,
  isoDateToInt,
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

  describe("ISO date parsing", () => {
    const accepted: [string, number][] = [
      ["1990-05-15", 19_900_515],
      ["2000-02-29", 20_000_229],
      ["1900-01-01", 19_000_101],
      ["2099-12-31", 20_991_231],
    ];
    const rejected = [
      "",
      " ",
      "invalid",
      "15/05/1990",
      "1990/05/15",
      "15-05-1990",
      "05/15/1990",
      "19900515",
      "1990-5-15",
      "1990-05-5",
      "90-05-15",
      "0050-05-15",
      " 1990-05-15",
      "1990-05-15 ",
      "1990-05-15T00:00:00Z",
      "1990-05-15abc",
      "1990-13-01",
      "1990-00-10",
      "1990-05-00",
      "1990-05-32",
      "1990-02-30",
      "2023-02-29",
      "1900-02-29",
      "1990-04-31",
    ];

    it.each(accepted)("accepts %s as %i", (value, expected) => {
      expect(isoDateToInt(value)).toBe(expected);
    });

    it.each(rejected)("rejects %j", (value) => {
      expect(isoDateToInt(value)).toBeNull();
      expect(dobToDaysSince1900(value)).toBeUndefined();
      expect(parseBirthYearFromDob(value)).toBeUndefined();
    });

    it("rejects missing input", () => {
      expect(isoDateToInt(null)).toBeNull();
      expect(isoDateToInt(undefined)).toBeNull();
    });

    it("keeps dobDays and the birth year on the same parsed date", () => {
      expect(dobToDaysSince1900("1900-01-02")).toBe(1);
      expect(dobToDaysSince1900("1970-01-01")).toBe(25_567);
      expect(parseBirthYearFromDob("1990-12-31")).toBe(1990);
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
