import { describe, expect, it } from "vitest";

import {
  createSecretEnvelope,
  decryptSecretEnvelope,
} from "@/lib/privacy/crypto/passkey-vault";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

describe("passkey-vault", () => {
  const testUserId = "test-user-123";

  it("encrypts and decrypts a secret envelope", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    const decrypted = await decryptSecretEnvelope({
      secretId: envelope.secretId,
      secretType: "fhe_keys",
      encryptedBlob: envelope.encryptedBlob,
      wrappedDek: envelope.wrappedDek,
      credentialId: "cred-1",
      userId: testUserId,
      prfOutput,
      envelopeFormat: envelope.envelopeFormat,
    });

    expect(new TextDecoder().decode(decrypted)).toBe("vault-secret");
  });

  it("encrypts and decrypts a secret envelope (msgpack)", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "msgpack",
    });

    const decrypted = await decryptSecretEnvelope({
      secretId: envelope.secretId,
      secretType: "fhe_keys",
      encryptedBlob: envelope.encryptedBlob,
      wrappedDek: envelope.wrappedDek,
      credentialId: "cred-1",
      userId: testUserId,
      prfOutput,
      envelopeFormat: envelope.envelopeFormat,
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
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    await expect(
      decryptSecretEnvelope({
        secretId: envelope.secretId,
        secretType: "fhe_keys",
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek: envelope.wrappedDek,
        credentialId: "cred-2",
        userId: testUserId,
        prfOutput,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails decryption with the wrong user id", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    await expect(
      decryptSecretEnvelope({
        secretId: envelope.secretId,
        secretType: "fhe_keys",
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek: envelope.wrappedDek,
        credentialId: "cred-1",
        userId: "different-user",
        prfOutput,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails decryption with the wrong secret id", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    await expect(
      decryptSecretEnvelope({
        secretId: crypto.randomUUID(),
        secretType: "fhe_keys",
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek: envelope.wrappedDek,
        credentialId: "cred-1",
        userId: testUserId,
        prfOutput,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails decryption with the wrong secret type", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    await expect(
      decryptSecretEnvelope({
        secretId: envelope.secretId,
        secretType: "not_fhe_keys",
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek: envelope.wrappedDek,
        credentialId: "cred-1",
        userId: testUserId,
        prfOutput,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails decryption if encrypted blob is tampered", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    const tampered = new Uint8Array(envelope.encryptedBlob);
    // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
    tampered[tampered.length - 1] ^= 0xff;

    await expect(
      decryptSecretEnvelope({
        secretId: envelope.secretId,
        secretType: "fhe_keys",
        encryptedBlob: tampered,
        wrappedDek: envelope.wrappedDek,
        credentialId: "cred-1",
        userId: testUserId,
        prfOutput,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails decryption if wrapped DEK is tampered", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelope = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    const wrapper = JSON.parse(envelope.wrappedDek) as {
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
      decryptSecretEnvelope({
        secretId: envelope.secretId,
        secretType: "fhe_keys",
        encryptedBlob: envelope.encryptedBlob,
        wrappedDek: tamperedWrappedDek,
        credentialId: "cred-1",
        userId: testUserId,
        prfOutput,
        envelopeFormat: envelope.envelopeFormat,
      })
    ).rejects.toThrow();
  });

  it("fails decryption when using a wrapper from a different secret", async () => {
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const plaintext = new TextEncoder().encode("vault-secret");

    const envelopeA = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    const envelopeB = await createSecretEnvelope({
      secretType: "fhe_keys",
      plaintext,
      prfOutput,
      credentialId: "cred-1",
      userId: testUserId,
      prfSalt,
      envelopeFormat: "json",
    });

    await expect(
      decryptSecretEnvelope({
        secretId: envelopeB.secretId,
        secretType: "fhe_keys",
        encryptedBlob: envelopeB.encryptedBlob,
        wrappedDek: envelopeA.wrappedDek,
        credentialId: "cred-1",
        userId: testUserId,
        prfOutput,
        envelopeFormat: envelopeB.envelopeFormat,
      })
    ).rejects.toThrow();
  });
});
