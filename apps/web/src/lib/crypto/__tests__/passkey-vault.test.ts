import { describe, expect, it } from "vitest";

import {
  createSecretEnvelope,
  decryptSecretEnvelope,
} from "@/lib/crypto/passkey-vault";

describe("passkey-vault", () => {
  it("encrypts and decrypts a secret envelope", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      prfSalt,
    });

    const decrypted = await decryptSecretEnvelope({
      secretId: envelope.secretId,
      secretType: "fhe_keys",
      encryptedBlob: envelope.encryptedBlob,
      wrappedDek: envelope.wrappedDek,
      credentialId: "cred-1",
      prfOutput,
    });

    expect(new TextDecoder().decode(decrypted)).toBe("vault-secret");
  });

  it("fails decryption with the wrong credential id", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      prfSalt,
    });

    await expect(
      decryptSecretEnvelope({
        secretId: envelope.secretId,
        secretType: "fhe_keys",
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek: envelope.wrappedDek,
        credentialId: "cred-2",
        prfOutput,
      })
    ).rejects.toThrow();
  });
});
