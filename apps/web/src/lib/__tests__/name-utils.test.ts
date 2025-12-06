import { describe, it, expect } from "vitest";
import { getFirstPart, buildDisplayName, getGreetingName } from "../name-utils";

describe("name-utils", () => {
  describe("getFirstPart", () => {
    it("returns first word from multi-word string", () => {
      expect(getFirstPart("Juan Carlos")).toBe("Juan");
    });

    it("returns full string if single word", () => {
      expect(getFirstPart("Juan")).toBe("Juan");
    });

    it("handles empty string", () => {
      expect(getFirstPart("")).toBe("");
    });

    it("handles null", () => {
      expect(getFirstPart(null)).toBe("");
    });

    it("handles undefined", () => {
      expect(getFirstPart(undefined)).toBe("");
    });

    it("trims whitespace", () => {
      expect(getFirstPart("  Juan Carlos  ")).toBe("Juan");
    });

    it("handles multiple spaces between words", () => {
      expect(getFirstPart("Juan   Carlos")).toBe("Juan");
    });
  });

  describe("buildDisplayName", () => {
    it("combines first parts of first and last names", () => {
      expect(buildDisplayName("Juan Carlos", "Perez Garcia")).toBe("Juan Perez");
    });

    it("handles single word names", () => {
      expect(buildDisplayName("Juan", "Perez")).toBe("Juan Perez");
    });

    it("returns first name only if no last name", () => {
      expect(buildDisplayName("Juan Carlos", "")).toBe("Juan");
      expect(buildDisplayName("Juan Carlos", null)).toBe("Juan");
    });

    it("returns last name only if no first name", () => {
      expect(buildDisplayName("", "Perez Garcia")).toBe("Perez");
      expect(buildDisplayName(null, "Perez Garcia")).toBe("Perez");
    });

    it("returns empty string if both empty", () => {
      expect(buildDisplayName("", "")).toBe("");
      expect(buildDisplayName(null, null)).toBe("");
    });

    it("handles whitespace-only strings", () => {
      expect(buildDisplayName("  ", "  ")).toBe("");
    });
  });

  describe("getGreetingName", () => {
    it("returns first part of full name", () => {
      expect(getGreetingName("Juan Perez")).toBe("Juan");
    });

    it("returns full single name", () => {
      expect(getGreetingName("Juan")).toBe("Juan");
    });

    it("handles null", () => {
      expect(getGreetingName(null)).toBe("");
    });

    it("handles undefined", () => {
      expect(getGreetingName(undefined)).toBe("");
    });

    it("handles empty string", () => {
      expect(getGreetingName("")).toBe("");
    });
  });
});
