import type {
  EnvelopeFormat,
  SecretType,
} from "../src/lib/privacy/secrets/types";

import { encode } from "@msgpack/msgpack";

const DEFAULT_ENVELOPE_FORMAT: EnvelopeFormat = "json";
const OPAQUE_CREDENTIAL_ID = "opaque";
const OPAQUE_KEK_SOURCE = "opaque" as const;
const OPAQUE_KEK_INFO = "zentity:kek:opaque";
const SECRET_AAD_CONTEXT = "zentity-secret-aad";
const WRAP_AAD_CONTEXT = "zentity-wrap-aad";
const AES_GCM_IV_BYTES = 12;

interface EncryptedSecretPayload {
  alg: "AES-GCM";
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

interface EncryptedSecretPayloadJson {
  alg: "AES-GCM";
  ciphertext: string;
  iv: string;
}

interface SeedSecretEnvelope {
  encryptedBlob: Uint8Array;
  envelopeFormat: EnvelopeFormat;
  secretId: string;
}

interface SeedOpaqueSecretWrapper {
  credentialId: typeof OPAQUE_CREDENTIAL_ID;
  kekSource: typeof OPAQUE_KEK_SOURCE;
  wrappedDek: string;
}

interface SeedOpaqueSecret {
  envelope: SeedSecretEnvelope;
  wrapper: SeedOpaqueSecretWrapper;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function encodeSeedAad(parts: string[]): Uint8Array {
  const encodedParts = parts.map((part) => new TextEncoder().encode(part));
  const totalLength = encodedParts.reduce(
    (sum, bytes) => sum + 4 + bytes.byteLength,
    0
  );
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const output = new Uint8Array(buffer);
  let offset = 0;

  for (const bytes of encodedParts) {
    view.setUint32(offset, bytes.byteLength, false);
    offset += 4;
    output.set(bytes, offset);
    offset += bytes.byteLength;
  }

  return output;
}

function seedBytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function encryptSeedAesGcm(
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Promise<EncryptedSecretPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      ...(additionalData
        ? { additionalData: toArrayBuffer(additionalData) }
        : {}),
    },
    key,
    toArrayBuffer(plaintext)
  );

  return { alg: "AES-GCM", ciphertext: new Uint8Array(ciphertext), iv };
}

async function deriveSeedKekFromOpaqueExport(
  exportKey: Uint8Array,
  userId: string
): Promise<CryptoKey> {
  if (!userId) {
    throw new Error("userId is required for KEK derivation.");
  }
  if (exportKey.byteLength !== 64) {
    throw new Error(
      `OPAQUE export key must be 64 bytes, got ${exportKey.byteLength}`
    );
  }

  const masterKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(exportKey),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: new TextEncoder().encode(userId),
      hash: "SHA-256",
      info: new TextEncoder().encode(OPAQUE_KEK_INFO),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function wrapSeedDek(params: {
  secretId: string;
  credentialId: string;
  userId: string;
  dek: Uint8Array;
  kek: CryptoKey;
}): Promise<string> {
  const aad = encodeSeedAad([
    WRAP_AAD_CONTEXT,
    params.secretId,
    params.credentialId,
    params.userId,
  ]);
  const wrapped = await encryptSeedAesGcm(params.kek, params.dek, aad);

  return JSON.stringify({
    alg: "AES-GCM",
    iv: seedBytesToBase64(wrapped.iv),
    ciphertext: seedBytesToBase64(wrapped.ciphertext),
  });
}

function serializeSeedPayload(
  payload: EncryptedSecretPayload,
  format: EnvelopeFormat
): Uint8Array {
  if (format === "msgpack") {
    return encode(payload);
  }

  const jsonPayload: EncryptedSecretPayloadJson = {
    alg: payload.alg,
    iv: seedBytesToBase64(payload.iv),
    ciphertext: seedBytesToBase64(payload.ciphertext),
  };
  return new TextEncoder().encode(JSON.stringify(jsonPayload));
}

function generateSeedDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function encryptSeedSecretWithDek(params: {
  dek: Uint8Array;
  envelopeFormat?: EnvelopeFormat;
  plaintext: Uint8Array;
  secretId: string;
  secretType: SecretType | string;
}): Promise<SeedSecretEnvelope> {
  const envelopeFormat = params.envelopeFormat ?? DEFAULT_ENVELOPE_FORMAT;
  const aad = encodeSeedAad([
    SECRET_AAD_CONTEXT,
    params.secretId,
    params.secretType,
  ]);
  const dekKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(params.dek),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
  const encrypted = await encryptSeedAesGcm(dekKey, params.plaintext, aad);

  return {
    encryptedBlob: serializeSeedPayload(
      {
        alg: "AES-GCM",
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
      },
      envelopeFormat
    ),
    envelopeFormat,
    secretId: params.secretId,
  };
}

async function wrapSeedDekWithOpaqueExport(params: {
  dek: Uint8Array;
  exportKey: Uint8Array;
  secretId: string;
  userId: string;
}): Promise<SeedOpaqueSecretWrapper> {
  const kek = await deriveSeedKekFromOpaqueExport(
    params.exportKey,
    params.userId
  );
  const wrappedDek = await wrapSeedDek({
    secretId: params.secretId,
    credentialId: OPAQUE_CREDENTIAL_ID,
    userId: params.userId,
    dek: params.dek,
    kek,
  });

  return {
    wrappedDek,
    credentialId: OPAQUE_CREDENTIAL_ID,
    kekSource: OPAQUE_KEK_SOURCE,
  };
}

export async function createE2EOpaqueSecret(params: {
  envelopeFormat?: EnvelopeFormat;
  exportKey: Uint8Array;
  plaintext: Uint8Array;
  secretId: string;
  secretType: SecretType | string;
  userId: string;
}): Promise<SeedOpaqueSecret> {
  const dek = generateSeedDek();
  const [envelope, wrapper] = await Promise.all([
    encryptSeedSecretWithDek({
      secretId: params.secretId,
      secretType: params.secretType,
      plaintext: params.plaintext,
      dek,
      envelopeFormat: params.envelopeFormat,
    }),
    wrapSeedDekWithOpaqueExport({
      secretId: params.secretId,
      userId: params.userId,
      dek,
      exportKey: params.exportKey,
    }),
  ]);

  return { envelope, wrapper };
}
