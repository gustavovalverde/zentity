import type { RecoveryEnvelope } from "../recovery-keys";

import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeAad, RECOVERY_AAD_CONTEXT } from "@/lib/privacy/primitives/aad";
import {
  mlKemDecapsulate,
  mlKemEncapsulate,
  mlKemKeygen,
} from "@/lib/privacy/primitives/ml-kem";
import { bytesToBase64 } from "@/lib/utils/base64";

import {
  deriveFrostUnwrapKey,
  unwrapDekWithFrostKey,
  wrapDekWithFrostKey,
} from "../recovery-keys";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

interface AadContext {
  secretId: string;
  userId: string;
}

/**
 * Simulates the client-side encryption flow (same logic as secrets/index.ts encryptDekForRecovery).
 * Returns the JSON envelope string that would be stored as wrappedDek.
 */
function clientEncryptDek(
  dek: Uint8Array,
  publicKey: Uint8Array,
  ctx: AadContext
): string {
  const { cipherText, sharedSecret } = mlKemEncapsulate(publicKey);

  const aad = encodeAad([RECOVERY_AAD_CONTEXT, ctx.secretId, ctx.userId]);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sharedSecret, iv);
  cipher.setAAD(aad);
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
  secretKey: Uint8Array,
  ctx: AadContext
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

  const aad = encodeAad([RECOVERY_AAD_CONTEXT, ctx.secretId, ctx.userId]);

  const { createDecipheriv } =
    require("node:crypto") as typeof import("node:crypto");
  const decipher = createDecipheriv("aes-256-gcm", sharedSecret, iv);
  decipher.setAuthTag(authTag);
  decipher.setAAD(aad);

  return new Uint8Array(
    Buffer.concat([decipher.update(encrypted), decipher.final()])
  );
}

describe("recovery-keys ML-KEM round-trip", () => {
  const { publicKey, secretKey } = mlKemKeygen();
  const ctx: AadContext = { secretId: randomUUID(), userId: randomUUID() };

  it("client encrypts DEK, server decrypts: recovered DEK matches original", () => {
    const dek = randomBytes(32);

    const wrappedDek = clientEncryptDek(dek, publicKey, ctx);
    const recovered = serverDecryptDek(wrappedDek, secretKey, ctx);

    expect(recovered).toEqual(new Uint8Array(dek));
  });

  it("tampered kemCipherText → AES-GCM auth tag failure (ML-KEM implicit reject)", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey, ctx);

    const envelope: RecoveryEnvelope = JSON.parse(wrappedDek);
    const kemBytes = Buffer.from(envelope.kemCipherText, "base64");
    const kemByte0 = kemBytes[0];
    if (kemByte0 !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      kemBytes[0] = kemByte0 ^ 0xff;
    }
    envelope.kemCipherText = kemBytes.toString("base64");

    expect(() =>
      serverDecryptDek(JSON.stringify(envelope), secretKey, ctx)
    ).toThrow();
  });

  it("tampered AES-GCM ciphertext → auth tag failure", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey, ctx);

    const envelope: RecoveryEnvelope = JSON.parse(wrappedDek);
    const ctBytes = Buffer.from(envelope.ciphertext, "base64");
    const ctByte0 = ctBytes[0];
    if (ctByte0 !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      ctBytes[0] = ctByte0 ^ 0xff;
    }
    envelope.ciphertext = ctBytes.toString("base64");

    expect(() =>
      serverDecryptDek(JSON.stringify(envelope), secretKey, ctx)
    ).toThrow();
  });

  it("tampered IV → auth tag failure", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey, ctx);

    const envelope: RecoveryEnvelope = JSON.parse(wrappedDek);
    const ivBytes = Buffer.from(envelope.iv, "base64");
    const ivByte0 = ivBytes[0];
    if (ivByte0 !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: intentional tampering for AEAD integrity test
      ivBytes[0] = ivByte0 ^ 0xff;
    }
    envelope.iv = ivBytes.toString("base64");

    expect(() =>
      serverDecryptDek(JSON.stringify(envelope), secretKey, ctx)
    ).toThrow();
  });

  it("malformed JSON envelope → parse error", () => {
    expect(() => serverDecryptDek("not-json", secretKey, ctx)).toThrow();
  });

  it("wrong recovery key pair → AES-GCM auth tag failure", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey, ctx);

    const eve = mlKemKeygen();
    expect(() => serverDecryptDek(wrappedDek, eve.secretKey, ctx)).toThrow();
  });

  it("empty DEK encrypts and decrypts cleanly", () => {
    const emptyDek = new Uint8Array(0);
    const wrappedDek = clientEncryptDek(emptyDek, publicKey, ctx);
    const recovered = serverDecryptDek(wrappedDek, secretKey, ctx);

    expect(recovered).toEqual(emptyDek);
  });

  it("envelope missing required fields → throws", () => {
    const partial = JSON.stringify({ alg: "ML-KEM-768" });
    expect(() => serverDecryptDek(partial, secretKey, ctx)).toThrow();
  });

  it("cross-slice: compliance bundle cannot be used as recovery envelope", async () => {
    const { encryptForRp } = await import("@/lib/privacy/compliance/encrypt");
    const rpKeys = mlKemKeygen();
    const bundle = await encryptForRp(
      new TextEncoder().encode("compliance-data"),
      bytesToBase64(rpKeys.publicKey),
      { clientId: "rp-test", userId: "user-test" }
    );

    expect(() =>
      serverDecryptDek(JSON.stringify(bundle), secretKey, ctx)
    ).toThrow();
  });
});

describe("recovery-keys AAD binding", () => {
  const { publicKey, secretKey } = mlKemKeygen();
  const userA = randomUUID();
  const userB = randomUUID();
  const secretX = randomUUID();
  const secretY = randomUUID();

  it("mismatched userId → auth tag failure (cross-user substitution blocked)", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey, {
      secretId: secretX,
      userId: userA,
    });

    expect(() =>
      serverDecryptDek(wrappedDek, secretKey, {
        secretId: secretX,
        userId: userB,
      })
    ).toThrow();
  });

  it("mismatched secretId → auth tag failure (cross-secret substitution blocked)", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey, {
      secretId: secretX,
      userId: userA,
    });

    expect(() =>
      serverDecryptDek(wrappedDek, secretKey, {
        secretId: secretY,
        userId: userA,
      })
    ).toThrow();
  });

  it("both userId and secretId mismatched → auth tag failure", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey, {
      secretId: secretX,
      userId: userA,
    });

    expect(() =>
      serverDecryptDek(wrappedDek, secretKey, {
        secretId: secretY,
        userId: userB,
      })
    ).toThrow();
  });

  it("correct userId and secretId → decryption succeeds", () => {
    const dek = randomBytes(32);
    const wrappedDek = clientEncryptDek(dek, publicKey, {
      secretId: secretX,
      userId: userA,
    });

    const recovered = serverDecryptDek(wrappedDek, secretKey, {
      secretId: secretX,
      userId: userA,
    });
    expect(recovered).toEqual(new Uint8Array(dek));
  });
});

describe("recovery key fingerprint (TOFU pinning)", () => {
  it("fingerprint is deterministic for the same public key", () => {
    const { publicKey } = mlKemKeygen();
    const fp1 = createHash("sha256").update(publicKey).digest("hex");
    const fp2 = createHash("sha256").update(publicKey).digest("hex");
    expect(fp1).toBe(fp2);
  });

  it("different keys produce different fingerprints", () => {
    const k1 = mlKemKeygen();
    const k2 = mlKemKeygen();
    const fp1 = createHash("sha256").update(k1.publicKey).digest("hex");
    const fp2 = createHash("sha256").update(k2.publicKey).digest("hex");
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprint is a 64-char hex string (SHA-256)", () => {
    const { publicKey } = mlKemKeygen();
    const fp = createHash("sha256").update(publicKey).digest("hex");
    expect(fp).toMatch(SHA256_HEX_PATTERN);
  });
});

describe("FROST crypto-gated DEK release", () => {
  const signatureHex = randomBytes(64).toString("hex");
  const challengeId = randomUUID();

  it("deriveFrostUnwrapKey is deterministic for the same inputs", () => {
    const k1 = deriveFrostUnwrapKey({ signatureHex, challengeId });
    const k2 = deriveFrostUnwrapKey({ signatureHex, challengeId });
    expect(k1).toEqual(k2);
  });

  it("different signatures produce different unwrap keys", () => {
    const k1 = deriveFrostUnwrapKey({ signatureHex, challengeId });
    const k2 = deriveFrostUnwrapKey({
      signatureHex: randomBytes(64).toString("hex"),
      challengeId,
    });
    expect(k1).not.toEqual(k2);
  });

  it("different challengeIds produce different unwrap keys", () => {
    const k1 = deriveFrostUnwrapKey({ signatureHex, challengeId });
    const k2 = deriveFrostUnwrapKey({
      signatureHex,
      challengeId: randomUUID(),
    });
    expect(k1).not.toEqual(k2);
  });

  it("wrap → unwrap round-trip recovers the original DEK", () => {
    const dek = randomBytes(32);
    const frostKey = deriveFrostUnwrapKey({ signatureHex, challengeId });
    const wrapped = wrapDekWithFrostKey(dek, frostKey);
    const recovered = unwrapDekWithFrostKey(wrapped, frostKey);
    expect(recovered).toEqual(new Uint8Array(dek));
  });

  it("wrong FROST key cannot unwrap DEK", () => {
    const dek = randomBytes(32);
    const correctKey = deriveFrostUnwrapKey({ signatureHex, challengeId });
    const wrongKey = deriveFrostUnwrapKey({
      signatureHex: randomBytes(64).toString("hex"),
      challengeId,
    });
    const wrapped = wrapDekWithFrostKey(dek, correctKey);
    expect(() => unwrapDekWithFrostKey(wrapped, wrongKey)).toThrow();
  });

  it("missing FROST signature means no unwrap key can be derived", () => {
    const dek = randomBytes(32);
    const frostKey = deriveFrostUnwrapKey({ signatureHex, challengeId });
    const wrapped = wrapDekWithFrostKey(dek, frostKey);
    // Without the correct signature, no valid key exists
    const fakeKey = deriveFrostUnwrapKey({
      signatureHex: "00".repeat(64),
      challengeId,
    });
    expect(() => unwrapDekWithFrostKey(wrapped, fakeKey)).toThrow();
  });
});
