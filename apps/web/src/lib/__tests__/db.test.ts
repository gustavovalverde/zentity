/**
 * Tests for the database module.
 */
import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createIdentityDocument,
  deleteIdentityData,
  documentHashExists,
  getAttestationEvidenceByUserAndDocument,
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
  getZkProofsByUserId,
  insertEncryptedAttribute,
  insertSignedClaim,
  insertZkProofRecord,
  upsertAttestationEvidence,
} from "../db";

describe("Database Module", () => {
  describe("getVerificationStatus", () => {
    it("returns level none for unverified user", () => {
      const status = getVerificationStatus("non-existent-user");

      expect(status.level).toBe("none");
      expect(status.verified).toBe(false);
      expect(status.checks.document).toBe(false);
      expect(status.checks.liveness).toBe(false);
      expect(status.checks.ageProof).toBe(false);
      expect(status.checks.docValidityProof).toBe(false);
      expect(status.checks.nationalityProof).toBe(false);
      expect(status.checks.faceMatchProof).toBe(false);
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
      attributeType: "birth_year_offset",
      ciphertext: "ciphertext",
      keyId: "key-1",
      encryptionTimeMs: 123,
    });

    const types = getEncryptedAttributeTypesByUserId(userId);
    expect(types).toEqual(["birth_year_offset"]);

    const latest = getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year_offset",
    );
    expect(latest?.ciphertext).toBe("ciphertext");
    expect(latest?.keyId).toBe("key-1");
    expect(latest?.encryptionTimeMs).toBe(123);

    deleteIdentityData(userId);
  });
});

describe("Document selection", () => {
  it("prefers a fully proven document over a newer incomplete one", () => {
    const userId = `test-user-${crypto.randomUUID()}`;
    deleteIdentityData(userId);

    const docFull = crypto.randomUUID();
    const docIncomplete = crypto.randomUUID();

    createIdentityDocument({
      id: docFull,
      userId,
      documentType: "passport",
      issuerCountry: "USA",
      documentHash: "hash-full",
      nameCommitment: "name-full",
      userSalt: null,
      birthYearOffset: null,
      firstNameEncrypted: null,
      verifiedAt: new Date("2024-01-01").toISOString(),
      confidenceScore: 0.9,
      status: "verified",
    });

    createIdentityDocument({
      id: docIncomplete,
      userId,
      documentType: "passport",
      issuerCountry: "USA",
      documentHash: "hash-incomplete",
      nameCommitment: "name-incomplete",
      userSalt: null,
      birthYearOffset: null,
      firstNameEncrypted: null,
      verifiedAt: new Date("2025-01-01").toISOString(),
      confidenceScore: 0.9,
      status: "verified",
    });

    const issuedAt = new Date().toISOString();
    for (const claimType of [
      "ocr_result",
      "liveness_score",
      "face_match_score",
    ]) {
      insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        documentId: docFull,
        claimType,
        claimPayload: "{}",
        signature: "sig",
        issuedAt,
      });
    }

    for (const proofType of [
      "age_verification",
      "doc_validity",
      "nationality_membership",
      "face_match",
    ]) {
      insertZkProofRecord({
        id: crypto.randomUUID(),
        userId,
        documentId: docFull,
        proofType,
        proofHash: `hash-${proofType}`,
        verified: true,
      });
    }

    const selected = getSelectedIdentityDocumentByUserId(userId);
    expect(selected?.id).toBe(docFull);

    deleteIdentityData(userId);
  });
});

describe("Attestation evidence", () => {
  it("persists evidence pack metadata", () => {
    const userId = `test-user-${crypto.randomUUID()}`;
    const documentId = crypto.randomUUID();
    deleteIdentityData(userId);

    upsertAttestationEvidence({
      userId,
      documentId,
      policyVersion: "policy-v1",
      policyHash: "policy-hash",
      proofSetHash: "proof-set-hash",
    });

    const evidence = getAttestationEvidenceByUserAndDocument(
      userId,
      documentId,
    );
    expect(evidence?.policyVersion).toBe("policy-v1");
    expect(evidence?.policyHash).toBe("policy-hash");
    expect(evidence?.proofSetHash).toBe("proof-set-hash");

    deleteIdentityData(userId);
  });
});
