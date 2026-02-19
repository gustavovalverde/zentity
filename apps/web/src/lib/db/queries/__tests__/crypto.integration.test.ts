import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { db } from "@/lib/db/connection";
import {
  createZkProofSession,
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
import { encryptedAttributes } from "@/lib/db/schema/crypto";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

async function createProofContext(userId: string, documentId?: string) {
  const resolvedDocumentId = documentId ?? crypto.randomUUID();
  const proofSessionId = crypto.randomUUID();
  const now = Date.now();
  await createZkProofSession({
    id: proofSessionId,
    userId,
    documentId: resolvedDocumentId,
    msgSender: userId,
    audience: "http://localhost:3000",
    policyVersion: POLICY_VERSION,
    createdAt: now,
    expiresAt: now + 60_000,
  });
  return { documentId: resolvedDocumentId, proofSessionId };
}

describe("crypto queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns age proof summary with encrypted attribute", async () => {
    const userId = await createTestUser();
    const { documentId, proofSessionId } = await createProofContext(userId);

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofSessionId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      policyVersion: POLICY_VERSION,
      verified: true,
      isOver18: true,
      generationTimeMs: 120,
    });

    await insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "web2_tfhe",
      attributeType: "birth_year_offset",
      ciphertext: Buffer.from("ciphertext"),
      keyId: "key-1",
      encryptionTimeMs: 55,
    });

    const summary = await getUserAgeProof(userId);
    const expectedHash = crypto
      .createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
      .update(Buffer.from("ciphertext"))
      .digest("hex");
    expect(summary?.isOver18).toBe(true);
    expect(summary?.generationTimeMs).toBe(120);
    expect(summary?.birthYearOffsetCiphertextHash).toBe(expectedHash);
    expect(summary?.birthYearOffsetCiphertextBytes).toBe(
      Buffer.byteLength("ciphertext")
    );
    expect(summary?.fheEncryptionTimeMs).toBe(55);
  });

  it("returns full age proof payload", async () => {
    const userId = await createTestUser();
    const { documentId, proofSessionId } = await createProofContext(userId);
    const payload = "proof-payload";
    const publicInputs = JSON.stringify(["1", "2", "3"]);

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofSessionId,
      proofType: "age_verification",
      proofHash: "proof-hash",
      policyVersion: POLICY_VERSION,
      verified: true,
      isOver18: false,
      proofPayload: payload,
      publicInputs,
      circuitType: "age_verification",
      noirVersion: "1.0.0",
      circuitHash: "circuit-hash",
      bbVersion: "0.8.0",
    });

    const full = await getUserAgeProofFull(userId);
    expect(full?.proof).toBe(payload);
    expect(full?.publicSignals).toEqual(["1", "2", "3"]);
    expect(full?.isOver18).toBe(false);
  });

  it("parses latest zk proof payload and handles invalid JSON", async () => {
    const userId = await createTestUser();
    const { documentId, proofSessionId } = await createProofContext(userId);

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofSessionId,
      proofType: "doc_validity",
      proofHash: "proof-hash",
      policyVersion: POLICY_VERSION,
      verified: true,
      proofPayload: "payload",
      publicInputs: JSON.stringify(["a", "b"]),
    });

    const parsed = await getLatestZkProofPayloadByUserAndType(
      userId,
      "doc_validity"
    );
    expect(parsed?.proof).toBe("payload");
    expect(parsed?.publicSignals).toEqual(["a", "b"]);

    const userIdInvalid = await createTestUser();
    const { documentId: invalidDocumentId, proofSessionId: invalidSessionId } =
      await createProofContext(userIdInvalid);
    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId: userIdInvalid,
      documentId: invalidDocumentId,
      proofSessionId: invalidSessionId,
      proofType: "doc_validity",
      proofHash: "proof-hash-2",
      policyVersion: POLICY_VERSION,
      verified: true,
      proofPayload: "payload",
      publicInputs: "not-json",
    });

    const invalid = await getLatestZkProofPayloadByUserAndType(
      userIdInvalid,
      "doc_validity"
    );
    expect(invalid).toBeNull();
  });

  it("returns proof hashes and signed claim types", async () => {
    const userId = await createTestUser();
    const documentId = crypto.randomUUID();
    const { proofSessionId } = await createProofContext(userId, documentId);

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofSessionId,
      proofType: "age_verification",
      proofHash: "hash-1",
      policyVersion: POLICY_VERSION,
      verified: true,
    });

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofSessionId,
      proofType: "doc_validity",
      proofHash: "hash-2",
      policyVersion: POLICY_VERSION,
      verified: true,
    });

    await insertZkProofRecord({
      id: crypto.randomUUID(),
      userId,
      documentId,
      proofSessionId,
      proofType: "face_match",
      proofHash: "hash-3",
      policyVersion: POLICY_VERSION,
      verified: false,
    });

    const hashes = await getProofHashesByUserAndDocument(userId, documentId);
    expect(hashes).toEqual(["hash-1", "hash-2"]);

    await insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "ocr_result",
      claimPayload: "{}",
      signature: "sig",
      issuedAt: "2025-01-01T00:00:00Z",
    });

    await insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "liveness_score",
      claimPayload: "{}",
      signature: "sig",
      issuedAt: "2025-01-02T00:00:00Z",
    });

    const claimTypes = await getSignedClaimTypesByUserAndDocument(
      userId,
      documentId
    );
    expect(claimTypes).toEqual(["liveness_score", "ocr_result"]);
  });

  it("returns latest signed claim and encrypted attributes", async () => {
    const userId = await createTestUser();
    const documentId = crypto.randomUUID();

    await insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "ocr_result",
      claimPayload: '{"result":1}',
      signature: "sig",
      issuedAt: "2025-01-01T00:00:00Z",
    });

    await insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      documentId,
      claimType: "ocr_result",
      claimPayload: '{"result":2}',
      signature: "sig",
      issuedAt: "2025-01-02T00:00:00Z",
    });

    const latestClaim = await getLatestSignedClaimByUserTypeAndDocument(
      userId,
      "ocr_result",
      documentId
    );
    expect(latestClaim?.claimPayload).toBe('{"result":2}');

    await insertEncryptedAttribute({
      id: crypto.randomUUID(),
      userId,
      source: "web2_tfhe",
      attributeType: "birth_year_offset",
      ciphertext: Buffer.from("cipher-2"),
      keyId: "key-2",
      encryptionTimeMs: 30,
    });

    const types = await getEncryptedAttributeTypesByUserId(userId);
    expect(types).toEqual(["birth_year_offset"]);

    const latestEncrypted = await getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year_offset"
    );
    expect(latestEncrypted?.ciphertext).toEqual(Buffer.from("cipher-2"));
    expect(latestEncrypted?.ciphertextHash).toBe(
      crypto
        .createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
        .update(Buffer.from("cipher-2"))
        .digest("hex")
    );
    expect(latestEncrypted?.keyId).toBe("key-2");
    expect(latestEncrypted?.encryptionTimeMs).toBe(30);
  });

  it("rejects tampered encrypted ciphertext when hash does not match", async () => {
    const userId = await createTestUser();
    const id = crypto.randomUUID();

    await insertEncryptedAttribute({
      id,
      userId,
      source: "web2_tfhe",
      attributeType: "dob_days",
      ciphertext: Buffer.from("cipher-original"),
      keyId: "key-1",
      encryptionTimeMs: 25,
    });

    await db
      .update(encryptedAttributes)
      .set({ ciphertext: Buffer.from("cipher-tampered") })
      .where(eq(encryptedAttributes.id, id))
      .run();

    await expect(
      getLatestEncryptedAttributeByUserAndType(userId, "dob_days")
    ).rejects.toThrow("Encrypted attribute integrity check failed");
  });
});
