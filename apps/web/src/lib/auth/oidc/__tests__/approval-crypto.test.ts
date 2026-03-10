import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  hashReleaseHandle,
  sealApprovalPii,
  unsealApprovalPii,
} from "@/lib/auth/oidc/approval-crypto";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const HEX_SHA256_RE = /^[a-f0-9]{64}$/;

describe("approval-crypto", () => {
  const samplePii = JSON.stringify({
    given_name: "Alice",
    family_name: "Smith",
    birthdate: "1990-01-15",
  });

  describe("sealApprovalPii", () => {
    it("returns all required fields", async () => {
      const result = await sealApprovalPii(samplePii);

      expect(result.releaseHandle).toBeTruthy();
      expect(result.releaseHandleHash).toBeTruthy();
      expect(result.encryptedPii).toBeTruthy();
      expect(result.encryptionIv).toBeTruthy();
    });

    it("produces a base64url release handle", async () => {
      const result = await sealApprovalPii(samplePii);
      expect(result.releaseHandle).toMatch(BASE64URL_RE);
    });

    it("produces a hex SHA-256 hash", async () => {
      const result = await sealApprovalPii(samplePii);
      expect(result.releaseHandleHash).toMatch(HEX_SHA256_RE);
    });

    it("hash matches the handle", async () => {
      const result = await sealApprovalPii(samplePii);
      const expectedHash = createHash("sha256")
        .update(Buffer.from(result.releaseHandle, "base64url"))
        .digest("hex");
      expect(result.releaseHandleHash).toBe(expectedHash);
    });

    it("generates unique handles on each call", async () => {
      const a = await sealApprovalPii(samplePii);
      const b = await sealApprovalPii(samplePii);
      expect(a.releaseHandle).not.toBe(b.releaseHandle);
      expect(a.releaseHandleHash).not.toBe(b.releaseHandleHash);
    });
  });

  describe("unsealApprovalPii", () => {
    it("round-trips PII through seal → unseal", async () => {
      const sealed = await sealApprovalPii(samplePii);
      const plaintext = await unsealApprovalPii(
        sealed.releaseHandle,
        sealed.encryptedPii,
        sealed.encryptionIv
      );
      expect(plaintext).toBe(samplePii);
      expect(JSON.parse(plaintext)).toEqual({
        given_name: "Alice",
        family_name: "Smith",
        birthdate: "1990-01-15",
      });
    });

    it("fails with a wrong release handle", async () => {
      const sealed = await sealApprovalPii(samplePii);
      const wrongHandle = randomBytes(32).toString("base64url");
      await expect(
        unsealApprovalPii(wrongHandle, sealed.encryptedPii, sealed.encryptionIv)
      ).rejects.toThrow();
    });

    it("fails with corrupted ciphertext", async () => {
      const sealed = await sealApprovalPii(samplePii);
      const corrupted = Buffer.from(sealed.encryptedPii, "base64");
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      corrupted[0] ^= 0x01;
      await expect(
        unsealApprovalPii(
          sealed.releaseHandle,
          corrupted.toString("base64"),
          sealed.encryptionIv
        )
      ).rejects.toThrow();
    });
  });

  describe("hashReleaseHandle", () => {
    it("matches the hash from sealApprovalPii", async () => {
      const sealed = await sealApprovalPii(samplePii);
      expect(hashReleaseHandle(sealed.releaseHandle)).toBe(
        sealed.releaseHandleHash
      );
    });

    it("is deterministic", async () => {
      const sealed = await sealApprovalPii(samplePii);
      expect(hashReleaseHandle(sealed.releaseHandle)).toBe(
        hashReleaseHandle(sealed.releaseHandle)
      );
    });
  });
});
