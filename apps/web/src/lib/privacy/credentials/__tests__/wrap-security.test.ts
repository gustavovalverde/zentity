import { describe, expect, it } from "vitest";

import { unwrapDek, wrapDek } from "@/lib/privacy/credentials/wrap";
import { generateDek } from "@/lib/privacy/secrets/envelope";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

describe("wrap binding pitfall tests", () => {
  const createAesGcmKey = async (): Promise<CryptoKey> =>
    crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt"]
    );

  it("rejects envelope swap attacks across credential bindings", async () => {
    const dekA = generateDek();
    const dekB = generateDek();
    const kek = await createAesGcmKey();

    const alice = {
      userId: crypto.randomUUID(),
      secretId: crypto.randomUUID(),
      credentialId: "passkey",
      dek: dekA,
    };
    const bob = {
      userId: crypto.randomUUID(),
      secretId: crypto.randomUUID(),
      credentialId: "wallet",
      dek: dekB,
    };

    const aliceWrapped = await wrapDek({
      secretId: alice.secretId,
      credentialId: alice.credentialId,
      userId: alice.userId,
      dek: alice.dek,
      kek,
    });

    const bobWrapped = await wrapDek({
      secretId: bob.secretId,
      credentialId: bob.credentialId,
      userId: bob.userId,
      dek: bob.dek,
      kek,
    });

    await expect(
      unwrapDek({
        secretId: alice.secretId,
        credentialId: alice.credentialId,
        userId: alice.userId,
        wrappedDek: bobWrapped,
        kek,
      })
    ).rejects.toThrow();

    await expect(
      unwrapDek({
        secretId: bob.secretId,
        credentialId: bob.credentialId,
        userId: bob.userId,
        wrappedDek: aliceWrapped,
        kek,
      })
    ).rejects.toThrow();
  });

  it("fails if encrypted DEK blob is tampered", async () => {
    const dek = generateDek();
    const kek = await createAesGcmKey();

    const secretId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const wrappedDek = await wrapDek({
      secretId,
      credentialId: "passkey",
      userId,
      dek,
      kek,
    });

    const parsed = JSON.parse(wrappedDek) as {
      iv: string;
      ciphertext: string;
      alg: string;
    };

    const ciphertextBytes = base64ToBytes(parsed.ciphertext);
    ciphertextBytes[0] = ((ciphertextBytes[0] ?? 0) + 1) % 256;
    parsed.ciphertext = bytesToBase64(ciphertextBytes);

    await expect(
      unwrapDek({
        secretId,
        credentialId: "passkey",
        userId,
        wrappedDek: JSON.stringify(parsed),
        kek,
      })
    ).rejects.toThrow();
  });
});
