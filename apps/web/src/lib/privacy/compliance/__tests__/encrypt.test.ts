import { describe, expect, it } from "vitest";

import { mlKemEncapsulate, mlKemKeygen } from "@/lib/privacy/primitives/ml-kem";
import { bytesToBase64 } from "@/lib/utils/base64";

import { decryptFromZentity } from "../decrypt";
import { encryptForRp } from "../encrypt";

const ctx = { clientId: "rp-bank-001", userId: "user-abc-123" };

describe("compliance encryption ML-KEM-768", () => {
  const { publicKey, secretKey } = mlKemKeygen();
  const rpPublicKeyBase64 = bytesToBase64(publicKey);

  it("round-trips: encryptForRp then decryptFromZentity recovers original data", async () => {
    const data = new TextEncoder().encode("compliance-data-payload");

    const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);
    const recovered = await decryptFromZentity(bundle, secretKey);

    expect(recovered).toEqual(data);
  });

  it("different RP secret key → AES-GCM failure (ML-KEM implicit reject)", async () => {
    const data = new TextEncoder().encode("secret");
    const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

    const eve = mlKemKeygen();
    await expect(decryptFromZentity(bundle, eve.secretKey)).rejects.toThrow();
  });

  it("tampered kemCipherText → failure", async () => {
    const data = new TextEncoder().encode("secret");
    const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

    const tampered = { ...bundle };
    const kemBytes = Buffer.from(tampered.kemCipherText, "base64");
    const kemByte0 = kemBytes[0];
    if (kemByte0 !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      kemBytes[0] = kemByte0 ^ 0xff;
    }
    tampered.kemCipherText = kemBytes.toString("base64");

    await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
  });

  it("tampered AES-GCM ciphertext → failure", async () => {
    const data = new TextEncoder().encode("secret");
    const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

    const tampered = { ...bundle };
    const ctBytes = Buffer.from(tampered.ciphertext, "base64");
    const ctByte0 = ctBytes[0];
    if (ctByte0 !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      ctBytes[0] = ctByte0 ^ 0xff;
    }
    tampered.ciphertext = ctBytes.toString("base64");

    await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
  });

  it("same data produces different ciphertext each time (fresh KEM + IV)", async () => {
    const data = new TextEncoder().encode("determinism-check");

    const a = await encryptForRp(data, rpPublicKeyBase64, ctx);
    const b = await encryptForRp(data, rpPublicKeyBase64, ctx);

    expect(a.kemCipherText).not.toBe(b.kemCipherText);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("handles empty data", async () => {
    const data = new Uint8Array(0);
    const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);
    const recovered = await decryptFromZentity(bundle, secretKey);

    expect(recovered).toEqual(data);
  });

  it("handles large data (50KB)", async () => {
    const data = crypto.getRandomValues(new Uint8Array(1024 * 50));
    const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);
    const recovered = await decryptFromZentity(bundle, secretKey);

    expect(recovered).toEqual(data);
  });

  it("bundle includes clientId and userId", async () => {
    const data = new TextEncoder().encode("context-check");
    const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

    expect(bundle.clientId).toBe(ctx.clientId);
    expect(bundle.userId).toBe(ctx.userId);
  });

  describe("AAD binding", () => {
    it("mismatched userId → AES-GCM failure (cross-user substitution blocked)", async () => {
      const data = new TextEncoder().encode("user-bound");
      const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

      const forged = { ...bundle, userId: "user-eve-999" };
      await expect(decryptFromZentity(forged, secretKey)).rejects.toThrow();
    });

    it("mismatched clientId → AES-GCM failure (cross-RP substitution blocked)", async () => {
      const data = new TextEncoder().encode("rp-bound");
      const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

      const forged = { ...bundle, clientId: "rp-evil-exchange" };
      await expect(decryptFromZentity(forged, secretKey)).rejects.toThrow();
    });

    it("both clientId and userId mismatched → failure", async () => {
      const data = new TextEncoder().encode("double-mismatch");
      const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

      const forged = { ...bundle, clientId: "rp-evil", userId: "user-eve" };
      await expect(decryptFromZentity(forged, secretKey)).rejects.toThrow();
    });

    it("correct context → success", async () => {
      const data = new TextEncoder().encode("correct-context");
      const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

      const recovered = await decryptFromZentity(bundle, secretKey);
      expect(recovered).toEqual(data);
    });
  });

  describe("attack vectors", () => {
    it("tampered IV → AES-GCM failure", async () => {
      const data = new TextEncoder().encode("secret");
      const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

      const tampered = { ...bundle };
      const ivBytes = Buffer.from(tampered.iv, "base64");
      const ivByte0 = ivBytes[0];
      if (ivByte0 !== undefined) {
        // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
        ivBytes[0] = ivByte0 ^ 0xff;
      }
      tampered.iv = ivBytes.toString("base64");

      await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
    });

    it("alg field tampering does not bypass decryption checks", async () => {
      const data = new TextEncoder().encode("secret");
      const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

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
        clientId: ctx.clientId,
        userId: ctx.userId,
      };

      // Attempt to decrypt recovery bundle with compliance RP key → must fail
      expect(decryptFromZentity(recoveryBundle, secretKey)).rejects.toThrow();
    });

    it("truncated kemCipherText → size validation failure", async () => {
      const data = new TextEncoder().encode("secret");
      const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

      const tampered = { ...bundle };
      tampered.kemCipherText = Buffer.from(new Uint8Array(100)).toString(
        "base64"
      );

      await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
    });

    it("empty kemCipherText → rejection", async () => {
      const data = new TextEncoder().encode("secret");
      const bundle = await encryptForRp(data, rpPublicKeyBase64, ctx);

      const tampered = { ...bundle };
      tampered.kemCipherText = "";

      await expect(decryptFromZentity(tampered, secretKey)).rejects.toThrow();
    });
  });
});
