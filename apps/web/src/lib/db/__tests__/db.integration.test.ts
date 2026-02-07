/**
 * Tests for the database module.
 */
import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  getAttestationEvidenceByUserAndDocument,
  upsertAttestationEvidence,
} from "@/lib/db/queries/attestation";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getZkProofsByUserId,
  insertEncryptedAttribute,
  insertSignedClaim,
  insertZkProofRecord,
} from "@/lib/db/queries/crypto";
import {
  createIdentityDocument,
  documentHashExists,
  getSelectedIdentityDocumentByUserId,
  getVerificationStatus,
} from "@/lib/db/queries/identity";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("Database Module", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("getVerificationStatus", () => {
    it("returns level none for unverified user", async () => {
      const userId = await createTestUser();
      const status = await getVerificationStatus(userId);

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
    it("returns true for existing hash", async () => {
      const userId = await createTestUser();
      await createIdentityDocument({
        id: crypto.randomUUID(),
        userId,
        documentHash: "existing-hash",
        nameCommitment: "name-commit",
        verifiedAt: "2025-01-01T00:00:00Z",
        confidenceScore: 0.9,
        status: "verified",
      });

      await expect(documentHashExists("existing-hash")).resolves.toBe(true);
      await expect(documentHashExists("missing-hash")).resolves.toBe(false);
    });
  });
});

describe("ZK proofs and encrypted attributes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("persists zk proof records", async () => {
    const userId = await createTestUser();

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      verified: true,
    });

    const proofs = await getZkProofsByUserId(userId);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.proofType).toBe("age_verification");
    expect(Boolean(proofs[0]?.verified)).toBe(true);
  });

  it("persists encrypted attributes", async () => {
    const userId = await createTestUser();

    await insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "web2_tfhe",
      attributeType: "birth_year_offset",
      ciphertext: Buffer.from("ciphertext"),
      keyId: "key-1",
      encryptionTimeMs: 123,
    });

    const types = await getEncryptedAttributeTypesByUserId(userId);
    expect(types).toEqual(["birth_year_offset"]);

    const latest = await getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year_offset"
    );
    expect(latest?.ciphertext).toEqual(Buffer.from("ciphertext"));
    expect(latest?.keyId).toBe("key-1");
    expect(latest?.encryptionTimeMs).toBe(123);
  });
});

describe("Document selection", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("prefers a fully proven document over a newer incomplete one", async () => {
    const userId = await createTestUser();

    const docFull = crypto.randomUUID();
    const docIncomplete = crypto.randomUUID();

    await createIdentityDocument({
      id: docFull,
      userId,
      documentHash: "hash-full",
      nameCommitment: "name-full",
      verifiedAt: "2024-01-01T00:00:00Z",
      confidenceScore: 0.9,
      status: "verified",
    });

    await createIdentityDocument({
      id: docIncomplete,
      userId,
      documentHash: "hash-incomplete",
      nameCommitment: "name-incomplete",
      verifiedAt: "2025-01-01T00:00:00Z",
      confidenceScore: 0.9,
      status: "verified",
    });

    const issuedAt = new Date().toISOString();
    for (const claimType of [
      "ocr_result",
      "liveness_score",
      "face_match_score",
    ]) {
      await insertSignedClaim({
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
      await insertZkProofRecord({
        id: crypto.randomUUID(),
        userId,
        documentId: docFull,
        proofType,
        proofHash: `hash-${proofType}`,
        verified: true,
      });
    }

    const selected = await getSelectedIdentityDocumentByUserId(userId);
    expect(selected?.id).toBe(docFull);
  });
});

describe("Attestation evidence", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("persists evidence pack metadata", async () => {
    const userId = await createTestUser();
    const documentId = crypto.randomUUID();

    await upsertAttestationEvidence({
      userId,
      documentId,
      policyVersion: "policy-v1",
      policyHash: "policy-hash",
      proofSetHash: "proof-set-hash",
    });

    const evidence = await getAttestationEvidenceByUserAndDocument(
      userId,
      documentId
    );
    expect(evidence?.policyVersion).toBe("policy-v1");
    expect(evidence?.policyHash).toBe("policy-hash");
    expect(evidence?.proofSetHash).toBe("proof-set-hash");
  });
});
