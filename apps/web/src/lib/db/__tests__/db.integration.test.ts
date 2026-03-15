/**
 * Tests for the database module.
 */
import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import {
  getAttestationEvidenceByUserAndVerification,
  upsertAttestationEvidence,
} from "@/lib/db/queries/attestation";
import {
  createZkProofSession,
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getZkProofsByUserId,
  insertEncryptedAttribute,
  insertSignedClaim,
  insertZkProofRecord,
} from "@/lib/db/queries/crypto";
import {
  createVerification,
  dedupKeyExistsForOtherUser,
  getSelectedVerification,
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
      expect(status.checks.identityBindingProof).toBe(false);
    });

    it("returns full level when all ZK proofs and signed claims are present", async () => {
      const userId = await createTestUser();
      const verificationId = crypto.randomUUID();
      const proofSessionId = crypto.randomUUID();
      const now = Date.now();

      await createVerification({
        id: verificationId,
        userId,
        method: "ocr",
        status: "verified",
        verifiedAt: new Date().toISOString(),
      });

      await createZkProofSession({
        id: proofSessionId,
        userId,
        verificationId,
        msgSender: userId,
        audience: "http://localhost:3000",
        policyVersion: POLICY_VERSION,
        createdAt: now,
        expiresAt: now + 60_000,
      });

      for (const proofType of [
        "age_verification",
        "doc_validity",
        "nationality_membership",
        "face_match",
        "identity_binding",
      ]) {
        await insertZkProofRecord({
          id: crypto.randomUUID(),
          userId,
          verificationId,
          proofSessionId,
          proofType,
          proofHash: `hash-${proofType}`,
          policyVersion: POLICY_VERSION,
          verified: true,
        });
      }

      for (const claimType of ["liveness_score", "face_match_score"]) {
        await insertSignedClaim({
          id: crypto.randomUUID(),
          userId,
          verificationId,
          claimType,
          claimPayload: "{}",
          signature: "sig",
          issuedAt: new Date().toISOString(),
        });
      }

      const status = await getVerificationStatus(userId);
      expect(status.level).toBe("full");
      expect(status.verified).toBe(true);
      expect(status.checks.ageProof).toBe(true);
      expect(status.checks.liveness).toBe(true);
      expect(status.checks.faceMatchProof).toBe(true);
      expect(status.checks.identityBindingProof).toBe(true);
    });

    it("returns lower level when proof session is incomplete", async () => {
      const userId = await createTestUser();
      const verificationId = crypto.randomUUID();
      const proofSessionId = crypto.randomUUID();
      const now = Date.now();

      await createVerification({
        id: verificationId,
        userId,
        method: "ocr",
        status: "verified",
        verifiedAt: new Date().toISOString(),
      });

      await createZkProofSession({
        id: proofSessionId,
        userId,
        verificationId,
        msgSender: userId,
        audience: "http://localhost:3000",
        policyVersion: POLICY_VERSION,
        createdAt: now,
        expiresAt: now + 60_000,
      });

      // Only 2 of 5 required proofs — incomplete session
      for (const proofType of ["age_verification", "doc_validity"]) {
        await insertZkProofRecord({
          id: crypto.randomUUID(),
          userId,
          verificationId,
          proofSessionId,
          proofType,
          proofHash: `hash-${proofType}`,
          policyVersion: POLICY_VERSION,
          verified: true,
        });
      }

      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        verificationId,
        claimType: "liveness_score",
        claimPayload: "{}",
        signature: "sig",
        issuedAt: new Date().toISOString(),
      });

      const status = await getVerificationStatus(userId);
      // Incomplete proof session: individual proof checks require all 5 in one session
      expect(status.checks.document).toBe(true);
      expect(status.checks.liveness).toBe(true);
      expect(status.checks.ageProof).toBe(false);
      expect(status.checks.faceMatchProof).toBe(false);
      expect(status.checks.identityBindingProof).toBe(false);
    });

    it("derives NFC chip compliance from signed claim, not boolean columns", async () => {
      const userId = await createTestUser();
      const verificationId = crypto.randomUUID();

      await createVerification({
        id: verificationId,
        userId,
        method: "nfc_chip",
        status: "verified",
        uniqueIdentifier: "nullifier-123",
        nationalityCommitment: "nat-commit",
        verifiedAt: new Date().toISOString(),
      });

      await insertSignedClaim({
        id: crypto.randomUUID(),
        userId,
        verificationId,
        claimType: "chip_verification",
        claimPayload: JSON.stringify({
          type: "chip_verification",
          userId,
          version: 1,
          data: {
            ageVerified: true,
            sanctionsCleared: true,
            faceMatchPassed: true,
            livenessScore: 1.0,
          },
        }),
        signature: "sig",
        issuedAt: new Date().toISOString(),
      });

      const status = await getVerificationStatus(userId);
      expect(status.level).toBe("chip");
      expect(status.verified).toBe(true);
      expect(status.checks.ageProof).toBe(true);
      expect(status.checks.faceMatchProof).toBe(true);
      expect(status.checks.liveness).toBe(true);
      expect(status.checks.nationalityProof).toBe(true);
      expect(status.checks.identityBindingProof).toBe(true);
    });

    it("NFC chip without signed claim returns false for derivable checks", async () => {
      const userId = await createTestUser();
      const verificationId = crypto.randomUUID();

      await createVerification({
        id: verificationId,
        userId,
        method: "nfc_chip",
        status: "verified",
        uniqueIdentifier: "nullifier-456",
        verifiedAt: new Date().toISOString(),
      });

      // No chip_verification signed claim
      const status = await getVerificationStatus(userId);
      expect(status.level).toBe("chip");
      expect(status.checks.ageProof).toBe(false);
      expect(status.checks.faceMatchProof).toBe(false);
      expect(status.checks.liveness).toBe(false);
    });
  });

  describe("dedupKeyExistsForOtherUser", () => {
    it("returns true when dedup key belongs to a different verified user", async () => {
      const userA = await createTestUser({ email: "a@test.com" });
      const userB = await createTestUser({ email: "b@test.com" });
      await createVerification({
        id: crypto.randomUUID(),
        userId: userA,
        method: "ocr",
        dedupKey: "dedup-key-1",
        status: "verified",
      });

      await expect(
        dedupKeyExistsForOtherUser("dedup-key-1", userB)
      ).resolves.toBe(true);
    });

    it("returns false when dedup key belongs to the same user (re-verification)", async () => {
      const userId = await createTestUser();
      await createVerification({
        id: crypto.randomUUID(),
        userId,
        method: "ocr",
        dedupKey: "dedup-key-2",
        status: "verified",
      });

      await expect(
        dedupKeyExistsForOtherUser("dedup-key-2", userId)
      ).resolves.toBe(false);
    });

    it("returns false when dedup key does not exist", async () => {
      const userId = await createTestUser();
      await expect(
        dedupKeyExistsForOtherUser("nonexistent", userId)
      ).resolves.toBe(false);
    });
  });
});

describe("ZK proofs and encrypted attributes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("persists zk proof records", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();
    const proofSessionId = crypto.randomUUID();
    const now = Date.now();

    await createZkProofSession({
      id: proofSessionId,
      userId,
      verificationId,
      msgSender: userId,
      audience: "http://localhost:3000",
      policyVersion: POLICY_VERSION,
      createdAt: now,
      expiresAt: now + 60_000,
    });

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      verificationId,
      proofSessionId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      policyVersion: POLICY_VERSION,
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

    await createVerification({
      id: docFull,
      userId,
      method: "ocr",
      documentHash: "hash-full",
      nameCommitment: "name-full",
      verifiedAt: "2024-01-01T00:00:00Z",
      confidenceScore: 0.9,
      status: "verified",
    });

    await createVerification({
      id: docIncomplete,
      userId,
      method: "ocr",
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
        verificationId: docFull,
        claimType,
        claimPayload: "{}",
        signature: "sig",
        issuedAt,
      });
    }

    const proofSessionId = crypto.randomUUID();
    const now = Date.now();
    await createZkProofSession({
      id: proofSessionId,
      userId,
      verificationId: docFull,
      msgSender: userId,
      audience: "http://localhost:3000",
      policyVersion: POLICY_VERSION,
      createdAt: now,
      expiresAt: now + 60_000,
    });

    for (const proofType of [
      "age_verification",
      "doc_validity",
      "nationality_membership",
      "face_match",
      "identity_binding",
    ]) {
      await insertZkProofRecord({
        id: crypto.randomUUID(),
        userId,
        verificationId: docFull,
        proofSessionId,
        proofType,
        proofHash: `hash-${proofType}`,
        policyVersion: POLICY_VERSION,
        verified: true,
      });
    }

    const selected = await getSelectedVerification(userId);
    expect(selected?.id).toBe(docFull);
  });
});

describe("Attestation evidence", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("persists evidence pack metadata", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();

    await upsertAttestationEvidence({
      userId,
      verificationId,
      policyVersion: "policy-v1",
      policyHash: "policy-hash",
      proofSetHash: "proof-set-hash",
    });

    const evidence = await getAttestationEvidenceByUserAndVerification(
      userId,
      verificationId
    );
    expect(evidence?.policyVersion).toBe("policy-v1");
    expect(evidence?.policyHash).toBe("policy-hash");
    expect(evidence?.proofSetHash).toBe("proof-set-hash");
  });
});
