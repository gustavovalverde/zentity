import "server-only";

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { env } from "@/env";
import {
  ML_KEM_SECRET_KEY_BYTES,
  mlKemGetPublicKey,
  mlKemKeygen,
} from "@/lib/privacy/primitives/post-quantum";
import { bytesToBase64 } from "@/lib/privacy/primitives/symmetric";

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
