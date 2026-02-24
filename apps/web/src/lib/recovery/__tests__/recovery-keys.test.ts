import type { RecoveryEnvelope } from "../recovery-keys";

import { createCipheriv, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  mlKemDecapsulate,
  mlKemEncapsulate,
  mlKemKeygen,
} from "@/lib/privacy/primitives/ml-kem";
import { bytesToBase64 } from "@/lib/utils/base64";

/**
 * Simulates the client-side encryption flow (same logic as secrets/index.ts encryptDekForRecovery).
 * Returns the JSON envelope string that would be stored as wrappedDek.
 */
function clientEncryptDek(dek: Uint8Array, publicKey: Uint8Array): string {
  const { cipherText, sharedSecret } = mlKemEncapsulate(publicKey);

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sharedSecret, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope: RecoveryEnvelope = {
    alg: "ML-KEM-768",
    kemCipherText: bytesToBase64(cipherText),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(
      new Uint8Array(Buffer.concat([encrypted, authTag]))
    ),
  };

  return JSON.stringify(envelope);
}

/**
 * Simulates the server-side decryption (same logic as recovery-keys.ts decryptRecoveryWrappedDek,
 * minus the file I/O and env vars).
 */
function serverDecryptDek(
  wrappedDek: string,
  secretKey: Uint8Array
): Uint8Array {
  const envelope: RecoveryEnvelope = JSON.parse(wrappedDek);

  const kemCipherText = Buffer.from(envelope.kemCipherText, "base64");
  const sharedSecret = mlKemDecapsulate(
    new Uint8Array(kemCipherText),
    secretKey
  );

  const iv = Buffer.from(envelope.iv, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  const authTagLength = 16;
  const encrypted = ciphertext.subarray(0, ciphertext.length - authTagLength);
  const authTag = ciphertext.subarray(ciphertext.length - authTagLength);

  const { createDecipheriv } =
    require("node:crypto") as typeof import("node:crypto");
  const decipher = createDecipheriv("aes-256-gcm", sharedSecret, iv);
  decipher.setAuthTag(authTag);

  return new Uint8Array(
    Buffer.concat([decipher.update(encrypted), decipher.final()])
  );
}

describe("recovery-keys ML-KEM round-trip", () => {
  const { publicKey, secretKey } = mlKemKeygen();

  it("client encrypts DEK, server decrypts: recovered DEK matches original", () => {
    const dek = randomBytes(32);

    const wrappedDek = clientEncryptDek(dek, publicKey);
    const recovered = serverDecryptDek(wrappedDek, secretKey);

    expect(recovered).toEqual(new Uint8Array(dek));
  });

  it("tampered kemCipherText → AES-GCM auth tag failure (ML-KEM implicit reject)", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey);

    const envelope: RecoveryEnvelope = JSON.parse(wrappedDek);
    const kemBytes = Buffer.from(envelope.kemCipherText, "base64");
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    kemBytes[0] ^= 0xff;
    envelope.kemCipherText = kemBytes.toString("base64");

    expect(() =>
      serverDecryptDek(JSON.stringify(envelope), secretKey)
    ).toThrow();
  });

  it("tampered AES-GCM ciphertext → auth tag failure", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey);

    const envelope: RecoveryEnvelope = JSON.parse(wrappedDek);
    const ctBytes = Buffer.from(envelope.ciphertext, "base64");
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    ctBytes[0] ^= 0xff;
    envelope.ciphertext = ctBytes.toString("base64");

    expect(() =>
      serverDecryptDek(JSON.stringify(envelope), secretKey)
    ).toThrow();
  });

  it("tampered IV → auth tag failure", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey);

    const envelope: RecoveryEnvelope = JSON.parse(wrappedDek);
    const ivBytes = Buffer.from(envelope.iv, "base64");
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    ivBytes[0] ^= 0xff;
    envelope.iv = ivBytes.toString("base64");

    expect(() =>
      serverDecryptDek(JSON.stringify(envelope), secretKey)
    ).toThrow();
  });

  it("malformed JSON envelope → parse error", () => {
    expect(() => serverDecryptDek("not-json", secretKey)).toThrow();
  });

  it("wrong recovery key pair → AES-GCM auth tag failure", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey);

    const eve = mlKemKeygen();
    expect(() => serverDecryptDek(wrappedDek, eve.secretKey)).toThrow();
  });

  it("empty DEK encrypts and decrypts cleanly", () => {
    const emptyDek = new Uint8Array(0);
    const wrappedDek = clientEncryptDek(emptyDek, publicKey);
    const recovered = serverDecryptDek(wrappedDek, secretKey);

    expect(recovered).toEqual(emptyDek);
  });

  it("envelope missing required fields → throws", () => {
    const partial = JSON.stringify({ alg: "ML-KEM-768" });
    expect(() => serverDecryptDek(partial, secretKey)).toThrow();
  });

  it("cross-slice: compliance bundle cannot be used as recovery envelope", async () => {
    // Import compliance encrypt — different key pair, same envelope shape
    const { encryptForRp } = await import("@/lib/privacy/compliance/encrypt");
    const rpKeys = mlKemKeygen();
    const bundle = await encryptForRp(
      new TextEncoder().encode("compliance-data"),
      bytesToBase64(rpKeys.publicKey)
    );

    // Feed compliance bundle to recovery decryptor with recovery key
    expect(() => serverDecryptDek(JSON.stringify(bundle), secretKey)).toThrow();
  });
});
