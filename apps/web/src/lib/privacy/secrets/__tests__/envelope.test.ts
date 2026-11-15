import { describe, expect, it } from "vitest";

import { decryptWithDek, encryptWithDek, generateDek } from "../envelope";

describe("secret envelope", () => {
  it("fails to decrypt a tampered payload", async () => {
    const secretId = crypto.randomUUID();
    const dek = generateDek();
    const envelope = await encryptWithDek({
      secretId,
      secretType: "fhe_keys",
      plaintext: new TextEncoder().encode("secret"),
      dek,
      envelopeFormat: "json",
    });

    const tampered = new Uint8Array(envelope.encryptedBlob);
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) === 0 ? 1 : 0;

    await expect(
      decryptWithDek({
        secretId,
        secretType: "fhe_keys",
        encryptedBlob: tampered,
        dek,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });
});
