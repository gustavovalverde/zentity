import "server-only";

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_KEY_ID = "v1";
const DEFAULT_KEY_PATH = join(process.cwd(), ".data", "recovery-key.pem");

const KEY_ID = process.env.RECOVERY_KEY_ID || DEFAULT_KEY_ID;
const KEY_PATH = process.env.RECOVERY_RSA_PRIVATE_KEY_PATH || DEFAULT_KEY_PATH;
const KEY_ENV = process.env.RECOVERY_RSA_PRIVATE_KEY;

let cachedKeys: {
  keyId: string;
  privateKey: ReturnType<typeof createPrivateKey>;
  publicKey: ReturnType<typeof createPublicKey>;
} | null = null;

function isProduction(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.APP_ENV === "production"
  );
}

function ensureKeyDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadOrCreatePrivateKeyPem(): string {
  if (KEY_ENV?.trim()) {
    return KEY_ENV.trim().replaceAll(String.raw`\n`, "\n");
  }

  if (existsSync(KEY_PATH)) {
    return readFileSync(KEY_PATH, "utf8");
  }

  if (isProduction()) {
    throw new Error(
      "RECOVERY_RSA_PRIVATE_KEY is required in production environments."
    );
  }

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x1_00_01,
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });

  ensureKeyDir(KEY_PATH);
  writeFileSync(KEY_PATH, privateKey, { mode: 0o600 });

  return privateKey;
}

function loadKeys() {
  if (cachedKeys) {
    return cachedKeys;
  }

  const privateKeyPem = loadOrCreatePrivateKeyPem();
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);

  cachedKeys = {
    keyId: KEY_ID,
    privateKey,
    publicKey,
  };

  return cachedKeys;
}

export function getRecoveryPublicKey(): { keyId: string; jwk: JsonWebKey } {
  const keys = loadKeys();
  const jwk = keys.publicKey.export({ format: "jwk" }) as JsonWebKey;
  return {
    keyId: keys.keyId,
    jwk: {
      ...jwk,
      alg: "RSA-OAEP-256",
      use: "enc",
    },
  };
}

export function decryptRecoveryWrappedDek(params: {
  wrappedDek: string;
  keyId: string;
}): Uint8Array {
  const keys = loadKeys();
  if (params.keyId !== keys.keyId) {
    throw new Error("Recovery key mismatch.");
  }

  const plaintext = privateDecrypt(
    {
      key: keys.privateKey,
      oaepHash: "sha256",
    },
    Buffer.from(params.wrappedDek, "base64")
  );

  return new Uint8Array(plaintext);
}
