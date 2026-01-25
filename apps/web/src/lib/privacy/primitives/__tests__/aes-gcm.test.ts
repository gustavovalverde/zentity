import { describe, expect, it } from "vitest";

import {
  decryptAesGcm,
  encryptAesGcm,
  generateIv,
} from "@/lib/privacy/primitives/aes-gcm";

function generateKey(): Promise<CryptoKey> {
  const keyMaterial = crypto.getRandomValues(new Uint8Array(32));
  return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

describe("aes-gcm", () => {
  it("round-trips AES-GCM encryption", async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode("hello-passkey");
    const aad = new TextEncoder().encode("aad");

    const encrypted = await encryptAesGcm(key, plaintext, aad);
    const decrypted = await decryptAesGcm(key, encrypted, aad);

    expect(new TextDecoder().decode(decrypted)).toBe("hello-passkey");
  });

  it("generates 12-byte IVs", () => {
    const iv = generateIv();
    expect(iv).toHaveLength(12);
  });

  it("generates unique IVs on each call", () => {
    const iv1 = generateIv();
    const iv2 = generateIv();
    expect(iv1).not.toEqual(iv2);
  });

  describe("error conditions", () => {
    it("fails decryption with wrong AAD", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");
      const correctAad = new TextEncoder().encode("correct-aad");
      const wrongAad = new TextEncoder().encode("wrong-aad");

      const encrypted = await encryptAesGcm(key, plaintext, correctAad);

      await expect(decryptAesGcm(key, encrypted, wrongAad)).rejects.toThrow();
    });

    it("fails decryption with missing AAD when encryption used AAD", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");
      const aad = new TextEncoder().encode("some-aad");

      const encrypted = await encryptAesGcm(key, plaintext, aad);

      await expect(decryptAesGcm(key, encrypted)).rejects.toThrow();
    });

    it("fails decryption with wrong key", async () => {
      const correctKey = await generateKey();
      const wrongKey = await generateKey();
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = await encryptAesGcm(correctKey, plaintext);

      await expect(decryptAesGcm(wrongKey, encrypted)).rejects.toThrow();
    });

    it("fails decryption with corrupted ciphertext (bit flip)", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = await encryptAesGcm(key, plaintext);

      // Flip a bit in the ciphertext
      const corrupted = new Uint8Array(encrypted.ciphertext);
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      corrupted[0] ^= 0x01;

      await expect(
        decryptAesGcm(key, { ...encrypted, ciphertext: corrupted })
      ).rejects.toThrow();
    });

    it("fails decryption with corrupted authentication tag", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = await encryptAesGcm(key, plaintext);

      // AES-GCM ciphertext includes the auth tag at the end (16 bytes)
      // Corrupt the last byte (part of the auth tag)
      const corrupted = new Uint8Array(encrypted.ciphertext);
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      corrupted[corrupted.length - 1] ^= 0xff;

      await expect(
        decryptAesGcm(key, { ...encrypted, ciphertext: corrupted })
      ).rejects.toThrow();
    });

    it("fails decryption with truncated ciphertext", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = await encryptAesGcm(key, plaintext);

      const truncated = encrypted.ciphertext.slice(0, -8);

      await expect(
        decryptAesGcm(key, { ...encrypted, ciphertext: truncated })
      ).rejects.toThrow();
    });

    it("fails decryption with wrong IV", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = await encryptAesGcm(key, plaintext);
      const wrongIv = generateIv();

      await expect(
        decryptAesGcm(key, { ...encrypted, iv: wrongIv })
      ).rejects.toThrow();
    });
  });

  describe("semantic security", () => {
    it("produces different ciphertexts for same plaintext (fresh IV)", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");

      const encrypted1 = await encryptAesGcm(key, plaintext);
      const encrypted2 = await encryptAesGcm(key, plaintext);

      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toEqual(encrypted2.iv);
    });

    it("decrypts correctly even with different ciphertexts for same plaintext", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");

      const encrypted1 = await encryptAesGcm(key, plaintext);
      const encrypted2 = await encryptAesGcm(key, plaintext);

      const decrypted1 = await decryptAesGcm(key, encrypted1);
      const decrypted2 = await decryptAesGcm(key, encrypted2);

      expect(decrypted1).toEqual(decrypted2);
      expect(decrypted1).toEqual(plaintext);
    });
  });

  describe("edge cases", () => {
    it("handles empty plaintext", async () => {
      const key = await generateKey();
      const plaintext = new Uint8Array(0);

      const encrypted = await encryptAesGcm(key, plaintext);
      const decrypted = await decryptAesGcm(key, encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("handles large plaintext", async () => {
      const key = await generateKey();
      const plaintext = crypto.getRandomValues(new Uint8Array(1024 * 50)); // 50KB (under 64KB getRandomValues limit)

      const encrypted = await encryptAesGcm(key, plaintext);
      const decrypted = await decryptAesGcm(key, encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("works without AAD", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");

      const encrypted = await encryptAesGcm(key, plaintext);
      const decrypted = await decryptAesGcm(key, encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("handles empty AAD", async () => {
      const key = await generateKey();
      const plaintext = new TextEncoder().encode("secret");
      const emptyAad = new Uint8Array(0);

      const encrypted = await encryptAesGcm(key, plaintext, emptyAad);
      const decrypted = await decryptAesGcm(key, encrypted, emptyAad);

      expect(decrypted).toEqual(plaintext);
    });
  });
});
