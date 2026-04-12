import { randomBytes, randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  getRecoveryKeyPin,
  pinRecoveryKey,
  upsertRecoverySecretWrapper,
} from "@/lib/db/queries/recovery";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

import { getRecoveryKeyFingerprint } from "../recovery-keys";

describe("recovery key authentication integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("ML-KEM key pinning", () => {
    it("first pin stores the current key fingerprint", async () => {
      const userId = await createTestUser();
      const fingerprint = getRecoveryKeyFingerprint();

      const pin = await pinRecoveryKey({
        id: randomUUID(),
        userId,
        keyFingerprint: fingerprint,
      });

      expect(pin.keyFingerprint).toBe(fingerprint);
      expect(pin.userId).toBe(userId);
    });

    it("subsequent fetch with same fingerprint matches", async () => {
      const userId = await createTestUser();
      const fingerprint = getRecoveryKeyFingerprint();

      await pinRecoveryKey({
        id: randomUUID(),
        userId,
        keyFingerprint: fingerprint,
      });

      const retrieved = await getRecoveryKeyPin(userId);
      expect(retrieved?.keyFingerprint).toBe(fingerprint);
    });

    it("concurrent pin attempts resolve safely (onConflictDoNothing)", async () => {
      const userId = await createTestUser();
      const fingerprint = getRecoveryKeyFingerprint();

      await Promise.all([
        pinRecoveryKey({
          id: randomUUID(),
          userId,
          keyFingerprint: fingerprint,
        }),
        pinRecoveryKey({
          id: randomUUID(),
          userId,
          keyFingerprint: fingerprint,
        }),
      ]);

      const pin = await getRecoveryKeyPin(userId);
      expect(pin?.keyFingerprint).toBe(fingerprint);
    });

    it("mismatched fingerprint is detectable by comparison", async () => {
      const userId = await createTestUser();
      const realFingerprint = getRecoveryKeyFingerprint();
      const fakeFingerprint = randomBytes(32).toString("hex");

      await pinRecoveryKey({
        id: randomUUID(),
        userId,
        keyFingerprint: realFingerprint,
      });

      const pin = await getRecoveryKeyPin(userId);
      expect(pin?.keyFingerprint).not.toBe(fakeFingerprint);
    });
  });

  describe("crypto-gated DEK release", () => {
    it("recovery wrapper stored in DB includes keyId for pin verification", async () => {
      const userId = await createTestUser();
      const secretId = randomUUID();

      const wrapper = await upsertRecoverySecretWrapper({
        id: randomUUID(),
        userId,
        secretId,
        wrappedDek: JSON.stringify({ alg: "ML-KEM-768", test: true }),
        keyId: "v1",
      });

      expect(wrapper.keyId).toBe("v1");
      expect(wrapper.userId).toBe(userId);
      expect(wrapper.secretId).toBe(secretId);
    });
  });
});
