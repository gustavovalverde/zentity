import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { POLICY_VERSION } from "@/lib/blockchain/attestation/policy";
import { db } from "@/lib/db/connection";
import {
  createProofSession,
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getLatestSignedClaimByUserTypeAndVerification,
  getUserAgeProof,
  getUserAgeProofFull,
  insertEncryptedAttribute,
  insertProofArtifact,
  insertSignedClaim,
} from "@/lib/db/queries/crypto";
import { encryptedAttributes } from "@/lib/db/schema/crypto";
import { encodeAad } from "@/lib/privacy/primitives/aad";
import { getCiphertextHmacKey } from "@/lib/privacy/primitives/derived-keys";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

function expectedHash(
  ciphertext: Buffer,
  userId: string,
  attributeType: string
): string {
  const context = encodeAad([userId, attributeType]);
  return crypto
    .createHmac("sha256", getCiphertextHmacKey())
    .update(context)
    .update(ciphertext)
    .digest("hex");
}

async function createProofContext(userId: string, verificationId?: string) {
  const resolvedDocumentId = verificationId ?? crypto.randomUUID();
  const proofSessionId = crypto.randomUUID();
  const now = Date.now();
  await createProofSession({
    id: proofSessionId,
    userId,
    verificationId: resolvedDocumentId,
    msgSender: userId,
    audience: "http://localhost:3000",
    policyVersion: POLICY_VERSION,
    createdAt: now,
    expiresAt: now + 60_000,
  });
  return { verificationId: resolvedDocumentId, proofSessionId };
}

describe("crypto queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns age proof summary with encrypted attribute", async () => {
    const userId = await createTestUser();
    const { verificationId, proofSessionId } = await createProofContext(userId);

    await insertProofArtifact({
      id: crypto.randomUUID(),
      userId,
      verificationId,
      proofSessionId,
      proofSystem: "noir_ultrahonk",
      proofType: "age_verification",
      proofHash: "proof-hash",
      policyVersion: POLICY_VERSION,
      verified: true,
      generationTimeMs: 120,
      metadata: JSON.stringify({ isOver18: true }),
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
    const expected = expectedHash(
      Buffer.from("ciphertext"),
      userId,
      "birth_year_offset"
    );
    expect(summary?.isOver18).toBe(true);
    expect(summary?.generationTimeMs).toBe(120);
    expect(summary?.birthYearOffsetCiphertextHash).toBe(expected);
    expect(summary?.birthYearOffsetCiphertextBytes).toBe(
      Buffer.byteLength("ciphertext")
    );
    expect(summary?.fheEncryptionTimeMs).toBe(55);
  });

  it("returns full age proof payload", async () => {
    const userId = await createTestUser();
    const { verificationId, proofSessionId } = await createProofContext(userId);
    const payload = "proof-payload";
    const publicInputs = JSON.stringify(["1", "2", "3"]);

    await insertProofArtifact({
      id: crypto.randomUUID(),
      userId,
      verificationId,
      proofSessionId,
      proofSystem: "noir_ultrahonk",
      proofType: "age_verification",
      proofHash: "proof-hash",
      policyVersion: POLICY_VERSION,
      verified: true,
      proofPayload: payload,
      publicInputs,
      metadata: JSON.stringify({
        isOver18: false,
        circuitType: "age_verification",
        noirVersion: "1.0.0",
        circuitHash: "circuit-hash",
        bbVersion: "0.8.0",
      }),
    });

    const full = await getUserAgeProofFull(userId);
    expect(full?.proof).toBe(payload);
    expect(full?.publicSignals).toEqual(["1", "2", "3"]);
    expect(full?.isOver18).toBe(false);
  });

  it("returns latest signed claim and encrypted attributes", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();

    await insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      verificationId,
      claimType: "ocr_result",
      claimPayload: '{"result":1}',
      signature: "sig",
      issuedAt: "2025-01-01T00:00:00Z",
    });

    await insertSignedClaim({
      id: crypto.randomUUID(),
      userId,
      verificationId,
      claimType: "ocr_result",
      claimPayload: '{"result":2}',
      signature: "sig",
      issuedAt: "2025-01-02T00:00:00Z",
    });

    const latestClaim = await getLatestSignedClaimByUserTypeAndVerification(
      userId,
      "ocr_result",
      verificationId
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
      expectedHash(Buffer.from("cipher-2"), userId, "birth_year_offset")
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
