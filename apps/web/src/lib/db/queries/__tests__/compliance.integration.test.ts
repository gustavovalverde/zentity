import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { rpEncryptionKeys } from "@/lib/db/schema/compliance";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { resetDatabase } from "@/test/db-test-utils";

import {
  createRpEncryptionKey,
  getActiveRpEncryptionKey,
  revokeRpEncryptionKey,
  rotateRpEncryptionKey,
} from "../compliance";

/** ML-KEM-768 public key length in bytes */
const ML_KEM_PUBLIC_KEY_BYTES = 1184;

async function createTestOAuthClient(clientId: string): Promise<void> {
  await db
    .insert(oauthClients)
    .values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: "test-secret",
      redirectUris: JSON.stringify(["https://example.com/callback"]),
    })
    .run();
}

// ML-KEM-768 public key (1184 bytes, base64 encoded)
const testPublicKey = Buffer.from(
  crypto.randomBytes(ML_KEM_PUBLIC_KEY_BYTES)
).toString("base64");
const testFingerprint = crypto
  .createHash("sha256")
  .update(Buffer.from(testPublicKey, "base64"))
  .digest("hex");

describe("compliance queries - RP encryption keys", () => {
  beforeEach(async () => {
    await resetDatabase();
    await db.delete(rpEncryptionKeys).run();
  });

  describe("createRpEncryptionKey", () => {
    it("creates a new encryption key", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const key = await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      expect(key.clientId).toBe(clientId);
      expect(key.publicKey).toBe(testPublicKey);
      expect(key.keyAlgorithm).toBe("ml-kem-768");
      expect(key.keyFingerprint).toBe(testFingerprint);
      expect(key.status).toBe("active");
      expect(key.previousKeyId).toBeNull();
    });

    it("throws when an active key already exists", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      await expect(
        createRpEncryptionKey({
          clientId,
          publicKey: testPublicKey,
          keyFingerprint: `${testFingerprint}-second`,
        })
      ).rejects.toThrow("Active encryption key already exists for this client");
    });

    it("creates key with custom ID", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const customId = crypto.randomUUID();
      const key = await createRpEncryptionKey({
        id: customId,
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      expect(key.id).toBe(customId);
    });
  });

  describe("getActiveRpEncryptionKey", () => {
    it("returns active key for client", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      const key = await getActiveRpEncryptionKey(clientId);
      expect(key).not.toBeNull();
      expect(key?.clientId).toBe(clientId);
      expect(key?.status).toBe("active");
    });

    it("returns null when no key exists", async () => {
      const key = await getActiveRpEncryptionKey("nonexistent-client");
      expect(key).toBeNull();
    });

    it("does not return revoked keys", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const key = await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      await revokeRpEncryptionKey(key.id);

      const activeKey = await getActiveRpEncryptionKey(clientId);
      expect(activeKey).toBeNull();
    });
  });

  describe("rotateRpEncryptionKey", () => {
    it("creates first key when none exists", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const newKey = await rotateRpEncryptionKey(
        clientId,
        testPublicKey,
        testFingerprint
      );

      expect(newKey.status).toBe("active");
      expect(newKey.previousKeyId).toBeNull();
    });
  });
});
