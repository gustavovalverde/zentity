import { describe, expect, it } from "vitest";

import {
  decryptWithDek,
  encryptWithDek,
  generateDek,
} from "@/lib/privacy/secrets/envelope";

import {
  unwrapDekWithWalletSignature,
  wrapDekWithWalletSignature,
} from "../wallet";

describe("wallet credentials", () => {
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

  it("fails to decrypt if encrypted payload is tampered", async () => {
    const secretId = crypto.randomUUID();
    const secretType = "fhe_keys";
    const userId = crypto.randomUUID();
    const address = "0x1234567890123456789012345678901234567890";
    const chainId = 1;
    const plaintext = new TextEncoder().encode("wallet-secret");
    const dek = generateDek();
    const signatureBytes = crypto.getRandomValues(new Uint8Array(65));

    const envelope = await encryptWithDek({
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
    const blobLastIdx = tamperedBlob.length - 1;
    const blobLastByte = tamperedBlob[blobLastIdx];
    if (blobLastByte !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      tamperedBlob[blobLastIdx] = blobLastByte ^ 0xff;
    }

    const unwrappedDek = await unwrapDekWithWalletSignature({
      secretId,
      userId,
      address,
      chainId,
      wrappedDek,
      signatureBytes,
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
});
