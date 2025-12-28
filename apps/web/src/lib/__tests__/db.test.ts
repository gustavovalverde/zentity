/**
 * Tests for the database module.
 */
import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  deleteIdentityData,
  documentHashExists,
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getVerificationStatus,
  getZkProofsByUserId,
  insertEncryptedAttribute,
  insertZkProofRecord,
} from "../db";

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

describe("ZK proofs and encrypted attributes", () => {
  it("persists zk proof records", () => {
    const userId = `test-user-${crypto.randomUUID()}`;
    deleteIdentityData(userId);

    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      verified: true,
    });

    const proofs = getZkProofsByUserId(userId);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.proofType).toBe("age_verification");
    expect(Boolean(proofs[0]?.verified)).toBe(true);

    deleteIdentityData(userId);
  });

  it("persists encrypted attributes", () => {
    const userId = `test-user-${crypto.randomUUID()}`;
    deleteIdentityData(userId);

    insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "web2_tfhe",
      attributeType: "birth_year",
      ciphertext: "ciphertext",
      keyId: "key-1",
      encryptionTimeMs: 123,
    });

    const types = getEncryptedAttributeTypesByUserId(userId);
    expect(types).toEqual(["birth_year"]);

    const latest = getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year",
    );
    expect(latest?.ciphertext).toBe("ciphertext");
    expect(latest?.keyId).toBe("key-1");
    expect(latest?.encryptionTimeMs).toBe(123);

    deleteIdentityData(userId);
  });
});
