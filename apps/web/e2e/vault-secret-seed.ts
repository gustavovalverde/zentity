import type {
  EnvelopeFormat,
  SecretType,
} from "../src/lib/privacy/secrets/catalog";

import { encode } from "@msgpack/msgpack";

const DEFAULT_ENVELOPE_FORMAT: EnvelopeFormat = "json";
const OPAQUE_CREDENTIAL_ID = "opaque";
const OPAQUE_KEK_INFO = "zentity:kek:opaque";
const VAULT_CREDENTIAL_ID = "vault";
const VAULT_KEK_INFO = "zentity:kek:vault";
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

interface SeedSecretWrapper {
  credentialId: string;
  kekSource: "opaque" | "vault";
  wrappedDek: string;
}

interface SeedSecret {
  dek: Uint8Array;
  envelope: SeedSecretEnvelope;
  wrapper: SeedSecretWrapper;
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

async function deriveSeedKek(
  ikm: Uint8Array,
  userId: string,
  info: string
): Promise<CryptoKey> {
  if (!userId) {
    throw new Error("userId is required for KEK derivation.");
  }

  const masterKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(ikm),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: new TextEncoder().encode(userId),
      hash: "SHA-256",
      info: new TextEncoder().encode(info),
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

/**
 * Seed a vault secret. The vault root (FHE keys) is wrapped with the OPAQUE
 * export key; every other secret is wrapped under the root's DEK.
 */
export async function createE2EVaultSecret(params: {
  envelopeFormat?: EnvelopeFormat;
  plaintext: Uint8Array;
  secretId: string;
  secretType: SecretType | string;
  userId: string;
  wrapWith:
    | { type: "opaque"; exportKey: Uint8Array }
    | { type: "vault"; vaultKey: Uint8Array };
}): Promise<SeedSecret> {
  const dek = generateSeedDek();
  const credentialId =
    params.wrapWith.type === "opaque"
      ? OPAQUE_CREDENTIAL_ID
      : VAULT_CREDENTIAL_ID;
  const kek =
    params.wrapWith.type === "opaque"
      ? await deriveSeedKek(
          params.wrapWith.exportKey,
          params.userId,
          OPAQUE_KEK_INFO
        )
      : await deriveSeedKek(
          params.wrapWith.vaultKey,
          params.userId,
          VAULT_KEK_INFO
        );

  const [envelope, wrappedDek] = await Promise.all([
    encryptSeedSecretWithDek({
      secretId: params.secretId,
      secretType: params.secretType,
      plaintext: params.plaintext,
      dek,
      envelopeFormat: params.envelopeFormat,
    }),
    wrapSeedDek({
      secretId: params.secretId,
      credentialId,
      userId: params.userId,
      dek,
      kek,
    }),
  ]);

  return {
    dek,
    envelope,
    wrapper: { credentialId, kekSource: params.wrapWith.type, wrappedDek },
  };
}
