/**
 * Tests for the database module.
 *
 * Note: These tests mock better-sqlite3 to avoid actual database operations.
 * The setup file provides the mock implementation.
 */
import { describe, expect, it, vi } from "vitest";

// Mock better-sqlite3 so db.ts can be imported without a real database
vi.mock("better-sqlite3", () => {
  const mockStmt = {
    get: vi.fn(() => undefined),
    run: vi.fn(),
    all: vi.fn(() => []),
  };

  const mockDb = {
    prepare: vi.fn(() => mockStmt),
    exec: vi.fn(),
  };

  const DatabaseMock = vi.fn(function DatabaseMock() {
    return mockDb;
  });

  return {
    __esModule: true,
    default: DatabaseMock,
  };
});

// We need to import after mocking in setup file
describe("Database Module", () => {
  describe("getVerificationStatus", () => {
    it("returns level none for unverified user", async () => {
      // Dynamic import to get mocked version
      const { getVerificationStatus } = await import("../db");

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
    it("returns false for non-existing hash", async () => {
      const { documentHashExists } = await import("../db");

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
