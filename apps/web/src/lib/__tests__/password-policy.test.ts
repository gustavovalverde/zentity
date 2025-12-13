import { describe, expect, it } from "vitest";
import {
  getPasswordLengthError,
  getPasswordRequirementStatus,
  getPasswordSimilarityError,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../password-policy";

describe("password-policy", () => {
  describe("getPasswordLengthError", () => {
    it("requires a password", () => {
      expect(getPasswordLengthError("")).toBe("Password is required");
    });

    it("enforces minimum length", () => {
      expect(getPasswordLengthError("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      );
      expect(getPasswordLengthError("a".repeat(PASSWORD_MIN_LENGTH))).toBe(
        undefined,
      );
    });

    it("enforces maximum length", () => {
      expect(getPasswordLengthError("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
        `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
      );
      expect(getPasswordLengthError("a".repeat(PASSWORD_MAX_LENGTH))).toBe(
        undefined,
      );
    });
  });

  describe("getPasswordSimilarityError", () => {
    it("blocks passwords containing email local-part", () => {
      expect(
        getPasswordSimilarityError("MyUser123456", {
          email: "user@example.com",
        }),
      ).toBe("Password can't contain your email");
    });

    it("normalizes punctuation in email local-part", () => {
      expect(
        getPasswordSimilarityError("johnDOE-123456", {
          email: "john.doe@example.com",
        }),
      ).toBe("Password can't contain your email");
    });

    it("blocks passwords containing document number", () => {
      expect(
        getPasswordSimilarityError("safe-ABC1234-password", {
          documentNumber: "ABC-1234",
        }),
      ).toBe("Password can't contain your document number");
    });

    it("ignores short identifiers", () => {
      expect(
        getPasswordSimilarityError("ab", {
          email: "ab@example.com",
          documentNumber: "123",
        }),
      ).toBe(undefined);
    });
  });

  describe("getPasswordRequirementStatus", () => {
    it("computes requirement flags", () => {
      const status = getPasswordRequirementStatus("user-1234567890", {
        email: "user@example.com",
        documentNumber: "ABC-1234",
      });

      expect(status.lengthOk).toBe(true);
      expect(status.noEmail).toBe(false);
      expect(status.noDocNumber).toBe(true);
    });
  });
});
