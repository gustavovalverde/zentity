import { describe, expect, it } from "vitest";

import {
  decryptSecretWithDek,
  encryptSecretWithDek,
  generateDek,
} from "@/lib/privacy/crypto/passkey-vault";
import {
  decryptSecretWithWalletSignature,
  unwrapDekWithWalletSignature,
  wrapDekWithWalletSignature,
} from "@/lib/privacy/crypto/wallet-vault";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

describe("wallet-vault wrapper", () => {
  it("wraps and unwraps a DEK with a wallet signature-derived KEK", async () => {
    const secretId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      dek,
      signatureBytes,
    });

    const unwrapped = await unwrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      wrappedDek,
      signatureBytes,
    });

    expect(unwrapped).toEqual(dek);
  });

  it("decrypts a secret envelope using wallet wrapper", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const plaintext = new TextEncoder().encode("wallet-secret");
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const envelope = await encryptSecretWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      dek,
      signatureBytes,
    });

    const decrypted = await decryptSecretWithWalletSignature({
      secretId,
      secretType,
      userId,
      address,
      chainId,
      encryptedBlob: envelope.encryptedBlob,
      wrappedDek,
      signatureBytes,
      envelopeFormat: envelope.envelopeFormat,
    });

    expect(new TextDecoder().decode(decrypted)).toBe("wallet-secret");
  });

  it("fails to decrypt with the wrong user id", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const plaintext = new TextEncoder().encode("wallet-secret");
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const envelope = await encryptSecretWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      dek,
      signatureBytes,
    });

    await expect(
      decryptSecretWithWalletSignature({
        secretId,
        secretType,
        userId: crypto.randomUUID(),
        address,
        chainId,
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek,
        signatureBytes,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt with the wrong chain id", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const plaintext = new TextEncoder().encode("wallet-secret");
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const envelope = await encryptSecretWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      dek,
      signatureBytes,
    });

    await expect(
      decryptSecretWithWalletSignature({
        secretId,
        secretType,
        userId,
        address,
        chainId: 11_155_111,
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek,
        signatureBytes,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt with the wrong address", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const plaintext = new TextEncoder().encode("wallet-secret");
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const envelope = await encryptSecretWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      dek,
      signatureBytes,
    });

    await expect(
      decryptSecretWithWalletSignature({
        secretId,
        secretType,
        userId,
        address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        chainId,
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek,
        signatureBytes,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt when signature bytes change", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const plaintext = new TextEncoder().encode("wallet-secret");
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));
    const differentSignatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const envelope = await encryptSecretWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      dek,
      signatureBytes,
    });

    await expect(
      decryptSecretWithWalletSignature({
        secretId,
        secretType,
        userId,
        address,
        chainId,
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek,
        signatureBytes: differentSignatureBytes,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt if wrapped DEK is tampered", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const plaintext = new TextEncoder().encode("wallet-secret");
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const envelope = await encryptSecretWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      dek,
      signatureBytes,
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
      decryptSecretWithWalletSignature({
        secretId,
        secretType,
        userId,
        address,
        chainId,
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek: tamperedWrappedDek,
        signatureBytes,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt if encrypted payload is tampered", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const plaintext = new TextEncoder().encode("wallet-secret");
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const envelope = await encryptSecretWithDek({
      secretId,
      secretType,
      plaintext,
      dek,
      envelopeFormat: "json",
    });

    const wrappedDek = await wrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      dek,
      signatureBytes,
    });

    const tamperedBlob = new Uint8Array(envelope.encryptedBlob);
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    tamperedBlob[tamperedBlob.length - 1] ^= 0xff;

    // Unwrapping should still work (wrapper not tampered), but payload decryption must fail.
    const unwrappedDek = await unwrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      wrappedDek,
      signatureBytes,
    });

    await expect(
      decryptSecretWithDek({
        secretId,
        secretType,
        encryptedBlob: tamperedBlob,
        dek: unwrappedDek,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails to decrypt when using a wrapper from a different secret", async () => {
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const secretIdA = crypto.randomUUID();
    const secretIdB = crypto.randomUUID();
    const secretType = "fhe_keys";

    const dekA = generateDek();
    const dekB = generateDek();
    const plaintext = new TextEncoder().encode("wallet-secret");

    const _envelopeA = await encryptSecretWithDek({
      secretId: secretIdA,
      secretType,
      plaintext,
      dek: dekA,
      envelopeFormat: "json",
    });
    const envelopeB = await encryptSecretWithDek({
      secretId: secretIdB,
      secretType,
      plaintext,
      dek: dekB,
      envelopeFormat: "json",
    });

    const wrappedDekA = await wrapDekWithWalletSignature({
      secretId: secretIdA,
      userId,
      address,
      chainId,
      dek: dekA,
      signatureBytes,
    });

    await expect(
      decryptSecretWithWalletSignature({
        secretId: secretIdB,
        secretType,
        userId,
        address,
        chainId,
        encryptedBlob: envelopeB.encryptedBlob,
        wrappedDek: wrappedDekA,
        signatureBytes,
        envelopeFormat: envelopeB.envelopeFormat,
      })
    ).rejects.toThrow();
  });
});
