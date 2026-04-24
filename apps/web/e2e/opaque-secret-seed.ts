import type {
  EnvelopeFormat,
  SecretType,
} from "../src/lib/privacy/secrets/types";

import { encode } from "@msgpack/msgpack";

import {
  deriveKekFromOpaqueExport,
  KEK_SOURCE,
} from "../src/lib/privacy/credentials/derivation";
import { wrapDek } from "../src/lib/privacy/credentials/wrap";
import {
  bytesToBase64,
  encodeAad,
  encryptAesGcm,
  SECRET_AAD_CONTEXT,
} from "../src/lib/privacy/primitives/symmetric";

const DEFAULT_ENVELOPE_FORMAT: EnvelopeFormat = "json";
const OPAQUE_CREDENTIAL_ID = "opaque";

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
  kekSource: typeof KEK_SOURCE.OPAQUE;
  wrappedDek: string;
}

interface SeedOpaqueSecret {
  envelope: SeedSecretEnvelope;
  wrapper: SeedOpaqueSecretWrapper;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
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
    iv: bytesToBase64(payload.iv),
    ciphertext: bytesToBase64(payload.ciphertext),
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
  const aad = encodeAad([
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
  const encrypted = await encryptAesGcm(dekKey, params.plaintext, aad);

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
  const kek = await deriveKekFromOpaqueExport(params.exportKey, params.userId);
  const wrappedDek = await wrapDek({
    secretId: params.secretId,
    credentialId: OPAQUE_CREDENTIAL_ID,
    userId: params.userId,
    dek: params.dek,
    kek,
  });

  return {
    wrappedDek,
    credentialId: OPAQUE_CREDENTIAL_ID,
    kekSource: KEK_SOURCE.OPAQUE,
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
