import { describe, expect, it } from "vitest";

import {
  decryptSecretWithOpaqueExport,
  unwrapDekWithOpaqueExport,
  wrapDekWithOpaqueExport,
} from "@/lib/privacy/credentials";
import {
  decryptWithDek,
  encryptWithDek,
  generateDek,
} from "@/lib/privacy/secrets/envelope";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

describe("opaque credentials", () => {
  it("wraps and unwraps a DEK with OPAQUE export key", async () => {
    const secretId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const dek = generateDek();
    const exportKey = crypto.getRandomValues(new Uint8Array(64));

    const wrappedDek = await wrapDekWithOpaqueExport({
      secretId,
      userId,
      dek,
      exportKey,
    });

    const unwrapped = await unwrapDekWithOpaqueExport({
      secretId,
      userId,
      wrappedDek,
      exportKey,
    });

    expect(unwrapped).toEqual(dek);
  });

  it("decrypts a secret envelope using an OPAQUE wrapper", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const plaintext = new TextEncoder().encode("opaque-secret");
    const dek = generateDek();
    const exportKey = crypto.getRandomValues(new Uint8Array(64));

    const envelope = await encryptWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithOpaqueExport({
      secretId,
      userId,
      dek,
      exportKey,
    });

    const decrypted = await decryptSecretWithOpaqueExport({
      secretId,
      secretType,
      userId,
      encryptedBlob: envelope.encryptedBlob,
      wrappedDek,
      exportKey,
      envelopeFormat: envelope.envelopeFormat,
    });

    expect(new TextDecoder().decode(decrypted)).toBe("opaque-secret");
  });

  it("fails to decrypt with the wrong user id", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const plaintext = new TextEncoder().encode("opaque-secret");
    const dek = generateDek();
    const exportKey = crypto.getRandomValues(new Uint8Array(64));

    const envelope = await encryptWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithOpaqueExport({
      secretId,
      userId,
      dek,
      exportKey,
    });

    await expect(
      decryptSecretWithOpaqueExport({
        secretId,
        secretType,
        userId: crypto.randomUUID(),
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek,
        exportKey,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt with the wrong secret type", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const plaintext = new TextEncoder().encode("opaque-secret");
    const dek = generateDek();
    const exportKey = crypto.getRandomValues(new Uint8Array(64));

    const envelope = await encryptWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithOpaqueExport({
      secretId,
      userId,
      dek,
      exportKey,
    });

    await expect(
      decryptSecretWithOpaqueExport({
        secretId,
        secretType: "not_fhe_keys",
        userId,
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek,
        exportKey,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt if wrapped DEK is tampered", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const plaintext = new TextEncoder().encode("opaque-secret");
    const dek = generateDek();
    const exportKey = crypto.getRandomValues(new Uint8Array(64));

    const envelope = await encryptWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithOpaqueExport({
      secretId,
      userId,
      dek,
      exportKey,
    });

    const wrapper = JSON.parse(wrappedDek) as {
      alg: string;
      iv: string;
      ciphertext: string;
    };
    const ciphertext = base64ToBytes(wrapper.ciphertext);
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    ciphertext[ciphertext.length - 1] ^= 0xff;
    wrapper.ciphertext = bytesToBase64(ciphertext);
    const tamperedWrappedDek = JSON.stringify(wrapper);

    await expect(
      decryptSecretWithOpaqueExport({
        secretId,
        secretType,
        userId,
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek: tamperedWrappedDek,
        exportKey,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt if encrypted payload is tampered", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const plaintext = new TextEncoder().encode("opaque-secret");
    const dek = generateDek();
    const exportKey = crypto.getRandomValues(new Uint8Array(64));

    const envelope = await encryptWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithOpaqueExport({
      secretId,
      userId,
      dek,
      exportKey,
    });

    const tamperedBlob = new Uint8Array(envelope.encryptedBlob);
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    tamperedBlob[tamperedBlob.length - 1] ^= 0xff;

    const unwrappedDek = await unwrapDekWithOpaqueExport({
      secretId,
      userId,
      wrappedDek,
      exportKey,
    });

    await expect(
      decryptWithDek({
        secretId,
        secretType,
        encryptedBlob: tamperedBlob,
        dek: unwrappedDek,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  describe("export key validation", () => {
    it("throws when export key is not 64 bytes (too short)", async () => {
      const secretId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const dek = generateDek();
      const shortExportKey = crypto.getRandomValues(new Uint8Array(32));

      await expect(
        wrapDekWithOpaqueExport({
          secretId,
          userId,
          dek,
          exportKey: shortExportKey,
        })
      ).rejects.toThrow("OPAQUE export key must be 64 bytes");
    });

    it("throws when export key is not 64 bytes (too long)", async () => {
      const secretId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const dek = generateDek();
      const longExportKey = crypto.getRandomValues(new Uint8Array(128));

      await expect(
        wrapDekWithOpaqueExport({
          secretId,
          userId,
          dek,
          exportKey: longExportKey,
        })
      ).rejects.toThrow("OPAQUE export key must be 64 bytes");
    });

    it("throws when export key is empty", async () => {
      const secretId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const dek = generateDek();
      const emptyExportKey = new Uint8Array(0);

      await expect(
        wrapDekWithOpaqueExport({
          secretId,
          userId,
          dek,
          exportKey: emptyExportKey,
        })
      ).rejects.toThrow("OPAQUE export key must be 64 bytes");
    });
  });

  describe("wrong export key", () => {
    it("fails unwrap with completely wrong export key", async () => {
      const secretId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const dek = generateDek();
      const correctExportKey = crypto.getRandomValues(new Uint8Array(64));
      const wrongExportKey = crypto.getRandomValues(new Uint8Array(64));

      const wrappedDek = await wrapDekWithOpaqueExport({
        secretId,
        userId,
        dek,
        exportKey: correctExportKey,
      });

      await expect(
        unwrapDekWithOpaqueExport({
          secretId,
          userId,
          wrappedDek,
          exportKey: wrongExportKey,
        })
      ).rejects.toThrow();
    });

    it("fails unwrap when export key differs by one byte", async () => {
      const secretId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const dek = generateDek();
      const correctExportKey = crypto.getRandomValues(new Uint8Array(64));
      const wrongExportKey = new Uint8Array(correctExportKey);
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional single-byte change for test
      wrongExportKey[0] ^= 0x01;

      const wrappedDek = await wrapDekWithOpaqueExport({
        secretId,
        userId,
        dek,
        exportKey: correctExportKey,
      });

      await expect(
        unwrapDekWithOpaqueExport({
          secretId,
          userId,
          wrappedDek,
          exportKey: wrongExportKey,
        })
      ).rejects.toThrow();
    });
  });
});
