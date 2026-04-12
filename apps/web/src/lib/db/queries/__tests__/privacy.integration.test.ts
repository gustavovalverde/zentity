import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  getEncryptedAttributeTypesByUserId,
  getLatestEncryptedAttributeByUserAndType,
  getLatestSignedClaimByUserTypeAndVerification,
  insertEncryptedAttribute,
  insertSignedClaim,
} from "@/lib/db/queries/privacy";
import { encryptedAttributes } from "@/lib/db/schema/privacy";
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
});
