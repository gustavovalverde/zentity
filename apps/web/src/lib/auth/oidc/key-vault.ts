import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ENVELOPE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

interface EncryptedEnvelope {
  ct: string;
  iv: string;
  v: number;
}

function deriveKek(raw: string): Buffer {
  return createHash("sha256").update(raw).digest();
}

let cachedKek: Buffer | null = null;

function getKek(): Buffer | null {
  if (cachedKek) {
    return cachedKek;
  }
  const raw = process.env.KEY_ENCRYPTION_KEY;
  if (!raw) {
    return null;
  }
  cachedKek = deriveKek(raw);
  return cachedKek;
}

export function encryptPrivateKey(plaintext: string): string {
  const kek = getKek();
  if (!kek) {
    return plaintext;
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, kek, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString("base64"),
    ct: Buffer.concat([encrypted, authTag]).toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function decryptPrivateKey(stored: string): string {
  const kek = getKek();

  if (!isEncryptedEnvelope(stored)) {
    return stored;
  }

  if (!kek) {
    throw new Error(
      "KEY_ENCRYPTION_KEY is required to decrypt JWKS private keys"
    );
  }

  const envelope = JSON.parse(stored) as EncryptedEnvelope;
  const iv = Buffer.from(envelope.iv, "base64");
  const combined = Buffer.from(envelope.ct, "base64");

  const authTag = combined.subarray(combined.length - AUTH_TAG_BYTES);
  const ciphertext = combined.subarray(0, combined.length - AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, kek, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith('{"v":');
}
