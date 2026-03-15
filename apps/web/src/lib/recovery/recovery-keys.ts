import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { env } from "@/env";
import { encodeAad, RECOVERY_AAD_CONTEXT } from "@/lib/privacy/primitives/aad";
import {
  ML_KEM_SECRET_KEY_BYTES,
  mlKemDecapsulate,
  mlKemGetPublicKey,
  mlKemKeygen,
} from "@/lib/privacy/primitives/ml-kem";
import { bytesToBase64 } from "@/lib/utils/base64";

const KEY_ID = "v1";
const KEY_PATH = join(process.cwd(), ".data/recovery-key.bin");
const KEY_ENV = env.RECOVERY_ML_KEM_SECRET_KEY;

let cachedKeys: {
  keyId: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
} | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function ensureKeyDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadOrCreateSecretKey(): Uint8Array {
  if (KEY_ENV?.trim()) {
    const bytes = Buffer.from(KEY_ENV.trim(), "base64");
    if (bytes.length !== ML_KEM_SECRET_KEY_BYTES) {
      throw new Error(
        `RECOVERY_ML_KEM_SECRET_KEY must be ${ML_KEM_SECRET_KEY_BYTES} bytes (base64), got ${bytes.length}`
      );
    }
    return new Uint8Array(bytes);
  }

  if (existsSync(KEY_PATH)) {
    const raw = readFileSync(KEY_PATH);
    if (raw.length !== ML_KEM_SECRET_KEY_BYTES) {
      throw new Error(
        `Recovery key file must be ${ML_KEM_SECRET_KEY_BYTES} bytes, got ${raw.length}`
      );
    }
    return new Uint8Array(raw);
  }

  if (isProduction()) {
    throw new Error(
      "RECOVERY_ML_KEM_SECRET_KEY is required in production environments."
    );
  }

  const { secretKey } = mlKemKeygen();
  ensureKeyDir(KEY_PATH);
  writeFileSync(KEY_PATH, Buffer.from(secretKey), { mode: 0o600 });

  return secretKey;
}

function loadKeys() {
  if (cachedKeys) {
    return cachedKeys;
  }

  const secretKey = loadOrCreateSecretKey();
  const publicKey = mlKemGetPublicKey(secretKey);

  cachedKeys = { keyId: KEY_ID, secretKey, publicKey };
  return cachedKeys;
}

export function getRecoveryPublicKey(): {
  keyId: string;
  alg: "ML-KEM-768";
  publicKey: string;
} {
  const keys = loadKeys();
  return {
    keyId: keys.keyId,
    alg: "ML-KEM-768",
    publicKey: bytesToBase64(keys.publicKey),
  };
}

export function getRecoveryKeyFingerprint(): string {
  const keys = loadKeys();
  return createHash("sha256").update(keys.publicKey).digest("hex");
}

export interface RecoveryEnvelope {
  alg: "ML-KEM-768";
  ciphertext: string;
  iv: string;
  kemCipherText: string;
}

export function decryptRecoveryWrappedDek(params: {
  wrappedDek: string;
  keyId: string;
  secretId: string;
  userId: string;
}): Uint8Array {
  const keys = loadKeys();
  if (params.keyId !== keys.keyId) {
    throw new Error("Recovery key mismatch.");
  }

  const envelope: RecoveryEnvelope = JSON.parse(params.wrappedDek);
  if (envelope.alg !== "ML-KEM-768") {
    throw new Error(`Unsupported recovery envelope algorithm: ${envelope.alg}`);
  }

  const kemCipherText = Buffer.from(envelope.kemCipherText, "base64");
  const sharedSecret = mlKemDecapsulate(
    new Uint8Array(kemCipherText),
    keys.secretKey
  );

  const iv = Buffer.from(envelope.iv, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  const authTagLength = 16;
  const encrypted = ciphertext.subarray(0, ciphertext.length - authTagLength);
  const authTag = ciphertext.subarray(ciphertext.length - authTagLength);

  const aad = encodeAad([RECOVERY_AAD_CONTEXT, params.secretId, params.userId]);

  const decipher = createDecipheriv("aes-256-gcm", sharedSecret, iv);
  decipher.setAuthTag(authTag);
  decipher.setAAD(aad);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return new Uint8Array(decrypted);
}

const FROST_UNWRAP_INFO = "zentity:frost-unwrap";

/**
 * Derive a 32-byte AES key from the FROST aggregated signature.
 * HKDF-SHA256(ikm=signature, salt=challengeId, info="zentity:frost-unwrap")
 */
export function deriveFrostUnwrapKey(params: {
  signatureHex: string;
  challengeId: string;
}): Buffer {
  const ikm = Buffer.from(params.signatureHex, "hex");
  return Buffer.from(
    hkdfSync("sha256", ikm, params.challengeId, FROST_UNWRAP_INFO, 32)
  );
}

/**
 * Encrypt a plaintext DEK under the FROST-derived unwrap key.
 * Returns base64(iv || ciphertext || authTag).
 */
export function wrapDekWithFrostKey(dek: Uint8Array, frostKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", frostKey, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return bytesToBase64(new Uint8Array(Buffer.concat([iv, encrypted, tag])));
}

/**
 * Decrypt a FROST-wrapped DEK using the FROST-derived unwrap key.
 * Input: base64(iv || ciphertext || authTag).
 */
export function unwrapDekWithFrostKey(
  wrappedBase64: string,
  frostKey: Buffer
): Uint8Array {
  const raw = Buffer.from(wrappedBase64, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const encrypted = raw.subarray(12, raw.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", frostKey, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(
    Buffer.concat([decipher.update(encrypted), decipher.final()])
  );
}
