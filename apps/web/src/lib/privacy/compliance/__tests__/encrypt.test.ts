import { describe, expect, it } from "vitest";

import { mlKemEncapsulate, mlKemKeygen } from "@/lib/privacy/primitives/ml-kem";
import { bytesToBase64 } from "@/lib/utils/base64";

import { decryptFromZentity } from "../decrypt";
import { encryptForRp } from "../encrypt";

describe("compliance encryption ML-KEM-768", () => {
  const { publicKey, secretKey } = mlKemKeygen();
  const rpPublicKeyBase64 = bytesToBase64(publicKey);

  it("round-trips: encryptForRp then decryptFromZentity recovers original data", async () => {
    const data = new TextEncoder().encode("compliance-data-payload");

    const bundle = await encryptForRp(data, rpPublicKeyBase64);
    const recovered = await decryptFromZentity(bundle, secretKey);

    expect(recovered).toEqual(data);
  });

  it("different RP secret key → AES-GCM failure (ML-KEM implicit reject)", async () => {
    const data = new TextEncoder().encode("secret");
    const bundle = await encryptForRp(data, rpPublicKeyBase64);

    const eve = mlKemKeygen();
    await expect(decryptFromZentity(bundle, eve.secretKey)).rejects.toThrow();
  });

  it("tampered kemCipherText → failure", async () => {
    const data = new TextEncoder().encode("secret");
    const bundle = await encryptForRp(data, rpPublicKeyBase64);

    const tampered = { ...bundle };
    const kemBytes = Buffer.from(tampered.kemCipherText, "base64");
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    kemBytes[0] ^= 0xff;
    tampered.kemCipherText = kemBytes.toString("base64");

    await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
  });

  it("tampered AES-GCM ciphertext → failure", async () => {
    const data = new TextEncoder().encode("secret");
    const bundle = await encryptForRp(data, rpPublicKeyBase64);

    const tampered = { ...bundle };
    const ctBytes = Buffer.from(tampered.ciphertext, "base64");
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    ctBytes[0] ^= 0xff;
    tampered.ciphertext = ctBytes.toString("base64");

    await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
  });

  it("same data produces different ciphertext each time (fresh KEM + IV)", async () => {
    const data = new TextEncoder().encode("determinism-check");

    const a = await encryptForRp(data, rpPublicKeyBase64);
    const b = await encryptForRp(data, rpPublicKeyBase64);

    expect(a.kemCipherText).not.toBe(b.kemCipherText);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("handles empty data", async () => {
    const data = new Uint8Array(0);
    const bundle = await encryptForRp(data, rpPublicKeyBase64);
    const recovered = await decryptFromZentity(bundle, secretKey);

    expect(recovered).toEqual(data);
  });

  it("handles large data (50KB)", async () => {
    const data = crypto.getRandomValues(new Uint8Array(1024 * 50));
    const bundle = await encryptForRp(data, rpPublicKeyBase64);
    const recovered = await decryptFromZentity(bundle, secretKey);

    expect(recovered).toEqual(data);
  });

  describe("attack vectors", () => {
    it("tampered IV → AES-GCM failure", async () => {
      const data = new TextEncoder().encode("secret");
      const bundle = await encryptForRp(data, rpPublicKeyBase64);

      const tampered = { ...bundle };
      const ivBytes = Buffer.from(tampered.iv, "base64");
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      ivBytes[0] ^= 0xff;
      tampered.iv = ivBytes.toString("base64");

      await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
    });

    it("alg field tampering does not bypass decryption checks", async () => {
      const data = new TextEncoder().encode("secret");
      const bundle = await encryptForRp(data, rpPublicKeyBase64);

      // Forge the alg field — cryptographic verification is key-based, not alg-based
      const forged = { ...bundle, alg: "RSA-OAEP" as "ML-KEM-768" };
      // Decryption still works because we verify by key, not by alg string
      const recovered = await decryptFromZentity(forged, secretKey);
      expect(recovered).toEqual(data);
    });

    it("cross-slice: recovery envelope cannot be decrypted as compliance bundle", () => {
      const { createCipheriv, randomBytes } =
        require("node:crypto") as typeof import("node:crypto");

      // Create a recovery-style envelope with a DIFFERENT key pair
      const recoveryKeys = mlKemKeygen();
      const { cipherText, sharedSecret } = mlKemEncapsulate(
        recoveryKeys.publicKey
      );
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", sharedSecret, iv);
      const encrypted = Buffer.concat([
        cipher.update(new TextEncoder().encode("recovery-dek")),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      const recoveryBundle = {
        alg: "ML-KEM-768" as const,
        kemCipherText: Buffer.from(cipherText).toString("base64"),
        iv: Buffer.from(iv).toString("base64"),
        ciphertext: Buffer.from(Buffer.concat([encrypted, authTag])).toString(
          "base64"
        ),
      };

      // Attempt to decrypt recovery bundle with compliance RP key → must fail
      expect(decryptFromZentity(recoveryBundle, secretKey)).rejects.toThrow();
    });

    it("truncated kemCipherText → size validation failure", async () => {
      const data = new TextEncoder().encode("secret");
      const bundle = await encryptForRp(data, rpPublicKeyBase64);

      const tampered = { ...bundle };
      tampered.kemCipherText = Buffer.from(new Uint8Array(100)).toString(
        "base64"
      );

      await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
    });

    it("empty kemCipherText → rejection", async () => {
      const data = new TextEncoder().encode("secret");
      const bundle = await encryptForRp(data, rpPublicKeyBase64);

      const tampered = { ...bundle };
      tampered.kemCipherText = "";

      await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
    });
  });
});
