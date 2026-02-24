import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { rpEncryptionKeys } from "@/lib/db/schema/compliance";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { ML_KEM_PUBLIC_KEY_BYTES } from "@/lib/privacy/primitives/ml-kem";
import { resetDatabase } from "@/test/db-test-utils";

import {
  createRpEncryptionKey,
  deleteAllRpEncryptionKeys,
  getActiveRpEncryptionKey,
  getAllRpEncryptionKeys,
  getRpEncryptionKeyById,
  revokeRpEncryptionKey,
  rotateRpEncryptionKey,
} from "../compliance";

async function createTestOAuthClient(clientId: string): Promise<void> {
  await db
    .insert(oauthClients)
    .values({
      id: crypto.randomUUID(),
      clientId,
      clientSecret: "test-secret",
      redirectUris: ["https://example.com/callback"],
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

  describe("getRpEncryptionKeyById", () => {
    it("returns key by ID", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const created = await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      const key = await getRpEncryptionKeyById(created.id);
      expect(key).not.toBeNull();
      expect(key?.id).toBe(created.id);
    });

    it("returns null for nonexistent ID", async () => {
      const key = await getRpEncryptionKeyById(crypto.randomUUID());
      expect(key).toBeNull();
    });
  });

  describe("getAllRpEncryptionKeys", () => {
    it("returns all keys for client including rotated", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const key1 = await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      await revokeRpEncryptionKey(key1.id);

      await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: `${testFingerprint}-new`,
      });

      const allKeys = await getAllRpEncryptionKeys(clientId);
      expect(allKeys.length).toBe(2);
    });

    it("returns empty array for client with no keys", async () => {
      const allKeys = await getAllRpEncryptionKeys("nonexistent");
      expect(allKeys).toEqual([]);
    });
  });

  describe("rotateRpEncryptionKey", () => {
    it("marks old key as rotated and creates new one", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const oldKey = await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      const newPublicKey = Buffer.from(
        crypto.randomBytes(ML_KEM_PUBLIC_KEY_BYTES)
      ).toString("base64");
      const newFingerprint = crypto
        .createHash("sha256")
        .update(Buffer.from(newPublicKey, "base64"))
        .digest("hex");

      const newKey = await rotateRpEncryptionKey(
        clientId,
        newPublicKey,
        newFingerprint
      );

      expect(newKey.status).toBe("active");
      expect(newKey.publicKey).toBe(newPublicKey);
      expect(newKey.previousKeyId).toBe(oldKey.id);

      const oldKeyAfter = await getRpEncryptionKeyById(oldKey.id);
      expect(oldKeyAfter?.status).toBe("rotated");
      expect(oldKeyAfter?.rotatedAt).not.toBeNull();
    });

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

  describe("revokeRpEncryptionKey", () => {
    it("marks key as revoked", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      const key = await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      await revokeRpEncryptionKey(key.id);

      const revokedKey = await getRpEncryptionKeyById(key.id);
      expect(revokedKey?.status).toBe("revoked");
    });
  });

  describe("deleteAllRpEncryptionKeys", () => {
    it("deletes all keys for client", async () => {
      const clientId = "test-client";
      await createTestOAuthClient(clientId);

      await createRpEncryptionKey({
        clientId,
        publicKey: testPublicKey,
        keyFingerprint: testFingerprint,
      });

      await deleteAllRpEncryptionKeys(clientId);

      const allKeys = await getAllRpEncryptionKeys(clientId);
      expect(allKeys).toEqual([]);
    });
  });
});
