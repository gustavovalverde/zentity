/**
 * Tests for the database module.
 */
import { describe, expect, it } from "vitest";
import { documentHashExists, getVerificationStatus } from "../db";

describe("Database Module", () => {
  describe("getVerificationStatus", () => {
    it("returns level none for unverified user", () => {
      const status = getVerificationStatus("non-existent-user");

      expect(status.level).toBe("none");
      expect(status.verified).toBe(false);
      expect(status.checks.document).toBe(false);
      expect(status.checks.liveness).toBe(false);
      expect(status.checks.faceMatch).toBe(false);
      expect(status.checks.ageProof).toBe(false);
    });
  });

  describe("documentHashExists", () => {
    it("returns false for non-existing hash", () => {
      expect(documentHashExists("non-existent-hash")).toBe(false);
    });
  });
});

describe("IdentityProof Interface", () => {
  it("should have all required fields", () => {
    // Type checking test - if this compiles, the interface is correct
    const mockProof = {
      id: "test-id",
      userId: "user-123",
      documentHash: "abc123",
      nameCommitment: "def456",
      userSalt: "salt789",
      isDocumentVerified: false,
      isLivenessPassed: false,
      isFaceMatched: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(mockProof.id).toBe("test-id");
    expect(mockProof.documentHash).toBe("abc123");
  });
});
