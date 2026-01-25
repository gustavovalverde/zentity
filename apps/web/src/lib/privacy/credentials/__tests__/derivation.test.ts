import { describe, expect, it } from "vitest";

import {
  deriveKekFromOpaqueExport,
  deriveKekFromPrf,
  deriveKekFromWalletSignature,
  generatePrfSalt,
} from "@/lib/privacy/credentials";
import { decryptAesGcm, encryptAesGcm } from "@/lib/privacy/primitives/aes-gcm";

describe("key-derivation", () => {
  describe("generatePrfSalt", () => {
    it("generates 32-byte salt", () => {
      const salt = generatePrfSalt();
      expect(salt).toHaveLength(32);
      expect(salt).toBeInstanceOf(Uint8Array);
    });

    it("generates unique salts", () => {
      const salt1 = generatePrfSalt();
      const salt2 = generatePrfSalt();
      expect(salt1).not.toEqual(salt2);
    });
  });

  describe("deriveKekFromPrf", () => {
    it("derives deterministic KEK from same input", async () => {
      const prfOutput = new Uint8Array(32).fill(0x42);
      const userId = "user-123";
      const kek1 = await deriveKekFromPrf(prfOutput, userId);
      const kek2 = await deriveKekFromPrf(prfOutput, userId);

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(kek1, testData);
      const decrypted = await decryptAesGcm(kek2, encrypted);

      expect(decrypted).toEqual(testData);
    });

    it("derives different KEKs from different PRF outputs", async () => {
      const prfOutput1 = new Uint8Array(32).fill(0x42);
      const prfOutput2 = new Uint8Array(32).fill(0x43);
      const userId = "user-123";
      const kek1 = await deriveKekFromPrf(prfOutput1, userId);
      const kek2 = await deriveKekFromPrf(prfOutput2, userId);

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(kek1, testData);

      await expect(decryptAesGcm(kek2, encrypted)).rejects.toThrow();
    });

    it("produces non-extractable CryptoKey", async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const kek = await deriveKekFromPrf(prfOutput, "user-123");

      expect(kek.extractable).toBe(false);
      expect(kek.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
      expect(kek.usages).toContain("encrypt");
      expect(kek.usages).toContain("decrypt");
    });

    it("derives different KEKs for different userIds with same PRF output", async () => {
      const prfOutput = new Uint8Array(32).fill(0x42);
      const kek1 = await deriveKekFromPrf(prfOutput, "user-1");
      const kek2 = await deriveKekFromPrf(prfOutput, "user-2");

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(kek1, testData);

      await expect(decryptAesGcm(kek2, encrypted)).rejects.toThrow();
    });
  });

  describe("deriveKekFromOpaqueExport", () => {
    it("derives deterministic KEK from same export key", async () => {
      const exportKey = new Uint8Array(64).fill(0x42);
      const userId = "user-123";
      const kek1 = await deriveKekFromOpaqueExport(exportKey, userId);
      const kek2 = await deriveKekFromOpaqueExport(exportKey, userId);

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(kek1, testData);
      const decrypted = await decryptAesGcm(kek2, encrypted);

      expect(decrypted).toEqual(testData);
    });

    it("throws on export key not equal to 64 bytes", async () => {
      const shortKey = new Uint8Array(32).fill(0x42);
      await expect(
        deriveKekFromOpaqueExport(shortKey, "user-123")
      ).rejects.toThrow("OPAQUE export key must be 64 bytes");
    });

    it("throws on empty export key", async () => {
      const emptyKey = new Uint8Array(0);
      await expect(
        deriveKekFromOpaqueExport(emptyKey, "user-123")
      ).rejects.toThrow("OPAQUE export key must be 64 bytes");
    });

    it("throws on export key that is too long", async () => {
      const longKey = new Uint8Array(128).fill(0x42);
      await expect(
        deriveKekFromOpaqueExport(longKey, "user-123")
      ).rejects.toThrow("OPAQUE export key must be 64 bytes");
    });

    it("produces non-extractable CryptoKey", async () => {
      const exportKey = crypto.getRandomValues(new Uint8Array(64));
      const kek = await deriveKekFromOpaqueExport(exportKey, "user-123");

      expect(kek.extractable).toBe(false);
      expect(kek.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    });

    it("derives different KEKs for different userIds with same export key", async () => {
      const exportKey = new Uint8Array(64).fill(0x42);
      const kek1 = await deriveKekFromOpaqueExport(exportKey, "user-1");
      const kek2 = await deriveKekFromOpaqueExport(exportKey, "user-2");

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(kek1, testData);

      await expect(decryptAesGcm(kek2, encrypted)).rejects.toThrow();
    });
  });

  describe("deriveKekFromWalletSignature", () => {
    it("derives deterministic KEK from same signature and userId", async () => {
      const signatureBytes = new Uint8Array(65).fill(0x42);
      const userId = "user-123";

      const kek1 = await deriveKekFromWalletSignature(signatureBytes, userId);
      const kek2 = await deriveKekFromWalletSignature(signatureBytes, userId);

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(kek1, testData);
      const decrypted = await decryptAesGcm(kek2, encrypted);

      expect(decrypted).toEqual(testData);
    });

    it("derives different KEKs for different userIds with same signature", async () => {
      const signatureBytes = new Uint8Array(65).fill(0x42);
      const kek1 = await deriveKekFromWalletSignature(signatureBytes, "user-1");
      const kek2 = await deriveKekFromWalletSignature(signatureBytes, "user-2");

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(kek1, testData);

      await expect(decryptAesGcm(kek2, encrypted)).rejects.toThrow();
    });

    it("throws on signature not equal to 65 bytes", async () => {
      const shortSignature = new Uint8Array(64).fill(0x42);
      await expect(
        deriveKekFromWalletSignature(shortSignature, "user-123")
      ).rejects.toThrow("Wallet signature must be 65 bytes");
    });

    it("throws on empty signature", async () => {
      const emptySignature = new Uint8Array(0);
      await expect(
        deriveKekFromWalletSignature(emptySignature, "user-123")
      ).rejects.toThrow("Wallet signature must be 65 bytes");
    });

    it("throws on signature that is too long", async () => {
      const longSignature = new Uint8Array(128).fill(0x42);
      await expect(
        deriveKekFromWalletSignature(longSignature, "user-123")
      ).rejects.toThrow("Wallet signature must be 65 bytes");
    });

    it("produces non-extractable CryptoKey", async () => {
      const signatureBytes = crypto.getRandomValues(new Uint8Array(65));
      const kek = await deriveKekFromWalletSignature(
        signatureBytes,
        "user-123"
      );

      expect(kek.extractable).toBe(false);
      expect(kek.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    });
  });

  describe("cross-credential isolation", () => {
    it("PRF and OPAQUE KEKs differ even with overlapping input bytes", async () => {
      const sharedBytes = new Uint8Array(64).fill(0x42);
      const prfInput = sharedBytes.slice(0, 32);
      const opaqueInput = sharedBytes;

      const userId = "user-123";
      const prfKek = await deriveKekFromPrf(prfInput, userId);
      const opaqueKek = await deriveKekFromOpaqueExport(opaqueInput, userId);

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(prfKek, testData);

      await expect(decryptAesGcm(opaqueKek, encrypted)).rejects.toThrow();
    });

    it("PRF and wallet KEKs differ for equivalent-sized inputs", async () => {
      const input = new Uint8Array(32).fill(0x42);

      const prfKek = await deriveKekFromPrf(input, "user-123");

      const walletInput = new Uint8Array(65).fill(0x42);
      const walletKek = await deriveKekFromWalletSignature(walletInput, "user");

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(prfKek, testData);

      await expect(decryptAesGcm(walletKek, encrypted)).rejects.toThrow();
    });

    it("different info strings produce different keys from same input", async () => {
      const prfOutput = new Uint8Array(32).fill(0x42);
      const userId = "user-123";
      const defaultKek = await deriveKekFromPrf(prfOutput, userId);
      const customKek = await deriveKekFromPrf(
        prfOutput,
        userId,
        "custom-info"
      );

      const testData = new TextEncoder().encode("test");
      const encrypted = await encryptAesGcm(defaultKek, testData);

      await expect(decryptAesGcm(customKek, encrypted)).rejects.toThrow();
    });
  });

  describe("semantic security", () => {
    it("encrypting same plaintext twice produces different ciphertexts", async () => {
      const prfOutput = crypto.getRandomValues(new Uint8Array(32));
      const kek = await deriveKekFromPrf(prfOutput, "user-123");
      const plaintext = new TextEncoder().encode("secret");

      const encrypted1 = await encryptAesGcm(kek, plaintext);
      const encrypted2 = await encryptAesGcm(kek, plaintext);

      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toEqual(encrypted2.iv);
    });
  });
});
