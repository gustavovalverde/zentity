import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  createProofSession,
  deleteVaultSecrets,
  getEncryptedAttributeTypesByUserId,
  getEncryptedSecretByUserAndType,
  getLatestEncryptedAttributeByUserAndType,
  getLatestSignedClaimByUserTypeAndVerification,
  getProofSessionById,
  insertEncryptedAttribute,
  insertProofArtifact,
  insertSignedClaim,
  updateEncryptedSecretMetadata,
  upsertSecretWrapper,
} from "@/lib/db/queries/privacy";
import {
  encryptedAttributes,
  encryptedSecrets,
  proofArtifacts,
} from "@/lib/db/schema/privacy";
import { getCiphertextHmacKey } from "@/lib/privacy/primitives/derived-keys";
import { encodeAad } from "@/lib/privacy/primitives/symmetric";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

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

describe("crypto queries", () => {
  beforeEach(async () => {
    await resetDatabase();
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

  it("stores proof sessions and artifacts with column defaults for omitted fields", async () => {
    const userId = await createTestUser();

    await createProofSession({
      id: "session-1",
      userId,
      verificationId: "verification-1",
      msgSender: "0xabc",
      audience: "rp",
      policyVersion: "1.0",
      createdAt: 1000,
      expiresAt: 2000,
    });
    await insertProofArtifact({
      id: "artifact-1",
      userId,
      proofSystem: "ultrahonk",
      proofType: "age_verification",
      proofHash: "hash-1",
    });

    const session = await getProofSessionById("session-1");
    const artifact = await db
      .select()
      .from(proofArtifacts)
      .where(eq(proofArtifacts.id, "artifact-1"))
      .get();

    expect(session).toMatchObject({ closedAt: null, expiresAt: 2000 });
    expect(artifact).toMatchObject({
      verified: false,
      verificationId: null,
      proofPayload: null,
      nonce: null,
    });
  });

  it("returns the wrapper row from an upsert, inserted or updated", async () => {
    const userId = await createTestUser();
    await db
      .insert(encryptedSecrets)
      .values({
        id: "secret-1",
        userId,
        secretType: "VAULT",
        encryptedBlob: "blob",
      })
      .run();

    const inserted = await upsertSecretWrapper({
      id: "wrapper-1",
      secretId: "secret-1",
      userId,
      credentialId: "credential-1",
      wrappedDek: "dek-1",
    });
    expect(inserted).toMatchObject({
      id: "wrapper-1",
      wrappedDek: "dek-1",
      kekSource: "prf",
      prfSalt: null,
    });

    const updated = await upsertSecretWrapper({
      id: "wrapper-2",
      secretId: "secret-1",
      userId,
      credentialId: "credential-1",
      wrappedDek: "dek-2",
      kekSource: "opaque",
    });
    expect(updated).toMatchObject({
      id: "wrapper-1",
      wrappedDek: "dek-2",
      kekSource: "opaque",
    });
  });

  it("returns the secret with parsed metadata after a metadata update", async () => {
    const userId = await createTestUser();
    await db
      .insert(encryptedSecrets)
      .values({
        id: "secret-1",
        userId,
        secretType: "PROFILE",
        encryptedBlob: "blob",
      })
      .run();

    const updated = await updateEncryptedSecretMetadata({
      userId,
      secretType: "PROFILE",
      metadata: { version: 2 },
    });
    expect(updated).toMatchObject({ id: "secret-1", metadata: { version: 2 } });

    await expect(
      updateEncryptedSecretMetadata({
        userId,
        secretType: "MISSING",
        metadata: null,
      })
    ).resolves.toBeNull();
  });

  it("deletes vault secrets inside a caller transaction as a savepoint", async () => {
    const userId = await createTestUser();
    await db
      .insert(encryptedSecrets)
      .values({
        id: "secret-1",
        userId,
        secretType: "VAULT",
        encryptedBlob: "blob",
      })
      .run();

    await expect(
      db.transaction(async (tx) => {
        const deleted = await deleteVaultSecrets(userId, tx);
        expect(deleted).toEqual(["secret-1"]);
        tx.rollback();
      })
    ).rejects.toThrow();
    expect(
      await getEncryptedSecretByUserAndType(userId, "VAULT")
    ).not.toBeNull();

    await expect(deleteVaultSecrets(userId)).resolves.toEqual(["secret-1"]);
    expect(await getEncryptedSecretByUserAndType(userId, "VAULT")).toBeNull();
  });
});
