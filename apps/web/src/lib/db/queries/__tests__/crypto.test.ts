import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getLatestSignedClaimByUserTypeAndDocument,
  getLatestZkProofPayloadByUserAndType,
  getProofHashesByUserAndDocument,
  getSignedClaimTypesByUserAndDocument,
  getUserAgeProof,
  getUserAgeProofFull,
  insertEncryptedAttribute,
  insertSignedClaim,
  insertZkProofRecord,
} from "@/lib/db/queries/crypto";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("crypto queries", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("returns age proof summary with encrypted attribute", () => {
    const userId = createTestUser();

    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      verified: true,
      isOver18: true,
      generationTimeMs: 120,
    });

    insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "web2_tfhe",
      attributeType: "birth_year_offset",
      ciphertext: "ciphertext",
      keyId: "key-1",
      encryptionTimeMs: 55,
    });

    const summary = getUserAgeProof(userId);
    expect(summary?.isOver18).toBe(true);
    expect(summary?.generationTimeMs).toBe(120);
    expect(summary?.birthYearOffsetCiphertext).toBe("ciphertext");
    expect(summary?.fheEncryptionTimeMs).toBe(55);
  });

  it("returns full age proof payload", () => {
    const userId = createTestUser();
    const payload = "proof-payload";
    const publicInputs = JSON.stringify(["1", "2", "3"]);

    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      verified: true,
      isOver18: false,
      proofPayload: payload,
      publicInputs,
      circuitType: "age_verification",
      noirVersion: "1.0.0",
      circuitHash: "circuit-hash",
      bbVersion: "0.8.0",
    });

    const full = getUserAgeProofFull(userId);
    expect(full?.proof).toBe(payload);
    expect(full?.publicSignals).toEqual(["1", "2", "3"]);
    expect(full?.isOver18).toBe(false);
  });

  it("parses latest zk proof payload and handles invalid JSON", () => {
    const userId = createTestUser();

    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      proofType: "doc_validity",
      proofHash: "proof-hash",
      verified: true,
      proofPayload: "payload",
      publicInputs: JSON.stringify(["a", "b"]),
    });

    const parsed = getLatestZkProofPayloadByUserAndType(userId, "doc_validity");
    expect(parsed?.proof).toBe("payload");
    expect(parsed?.publicSignals).toEqual(["a", "b"]);

    const userIdInvalid = createTestUser();
    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId: userIdInvalid,
      proofType: "doc_validity",
      proofHash: "proof-hash-2",
      verified: true,
      proofPayload: "payload",
      publicInputs: "not-json",
    });

    const invalid = getLatestZkProofPayloadByUserAndType(
      userIdInvalid,
      "doc_validity",
    );
    expect(invalid).toBeNull();
  });

  it("returns proof hashes and signed claim types", () => {
    const userId = createTestUser();
    const documentId = crypto.randomUUID();

    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofType: "age_verification",
      proofHash: "hash-1",
      verified: true,
    });

    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofType: "doc_validity",
      proofHash: "hash-2",
      verified: true,
    });

    insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofType: "face_match",
      proofHash: "hash-3",
      verified: false,
    });

    const hashes = getProofHashesByUserAndDocument(userId, documentId);
    expect(hashes).toEqual(["hash-1", "hash-2"]);

    insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "ocr_result",
      claimPayload: "{}",
      signature: "sig",
      issuedAt: "2025-01-01T00:00:00Z",
    });

    insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "liveness_score",
      claimPayload: "{}",
      signature: "sig",
      issuedAt: "2025-01-02T00:00:00Z",
    });

    const claimTypes = getSignedClaimTypesByUserAndDocument(userId, documentId);
    expect(claimTypes).toEqual(["liveness_score", "ocr_result"]);
  });

  it("returns latest signed claim and encrypted attributes", () => {
    const userId = createTestUser();
    const documentId = crypto.randomUUID();

    insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "ocr_result",
      claimPayload: '{"result":1}',
      signature: "sig",
      issuedAt: "2025-01-01T00:00:00Z",
    });

    insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "ocr_result",
      claimPayload: '{"result":2}',
      signature: "sig",
      issuedAt: "2025-01-02T00:00:00Z",
    });

    const latestClaim = getLatestSignedClaimByUserTypeAndDocument(
      userId,
      "ocr_result",
      documentId,
    );
    expect(latestClaim?.claimPayload).toBe('{"result":2}');

    insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "web2_tfhe",
      attributeType: "birth_year_offset",
      ciphertext: "cipher-2",
      keyId: "key-2",
      encryptionTimeMs: 30,
    });

    const types = getEncryptedAttributeTypesByUserId(userId);
    expect(types).toEqual(["birth_year_offset"]);

    const latestEncrypted = getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year_offset",
    );
    expect(latestEncrypted?.ciphertext).toBe("cipher-2");
    expect(latestEncrypted?.keyId).toBe("key-2");
    expect(latestEncrypted?.encryptionTimeMs).toBe(30);
  });
});
