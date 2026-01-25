"use client";

import "client-only";

/**
 * Envelope Encryption Module
 *
 * Provides credential-agnostic envelope encryption using AES-GCM.
 * A Data Encryption Key (DEK) encrypts the secret payload, and the
 * DEK is wrapped by a credential-derived Key Encryption Key (KEK)
 * handled by the credentials module.
 */

import type { EnvelopeFormat, SecretType } from "./types";

import { decode, encode } from "@msgpack/msgpack";

import { encodeAad, SECRET_AAD_CONTEXT } from "@/lib/privacy/primitives/aad";
import { decryptAesGcm, encryptAesGcm } from "@/lib/privacy/primitives/aes-gcm";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/base64";

const DEFAULT_ENVELOPE_FORMAT: EnvelopeFormat = "json";

/**
 * Encrypted payload structure (binary form for msgpack).
 */
export interface EncryptedSecretPayload {
  alg: "AES-GCM";
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Encrypted payload structure (JSON form).
 */
interface EncryptedSecretPayloadJson {
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
}

/**
 * Complete secret envelope ready for storage.
 */
export interface SecretEnvelope {
  secretId: string;
  encryptedBlob: Uint8Array;
  envelopeFormat: EnvelopeFormat;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function toJsonPayload(
  payload: EncryptedSecretPayload
): EncryptedSecretPayloadJson {
  return {
    alg: payload.alg,
    iv: bytesToBase64(payload.iv),
    ciphertext: bytesToBase64(payload.ciphertext),
  };
}

function serializePayload(
  payload: EncryptedSecretPayload,
  format: EnvelopeFormat
): Uint8Array {
  if (format === "msgpack") {
    return encode(payload);
  }
  return textEncoder.encode(JSON.stringify(toJsonPayload(payload)));
}

function ensureUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("Invalid binary payload.");
}

function parsePayload(
  blob: Uint8Array,
  format: EnvelopeFormat
): EncryptedSecretPayload {
  if (format === "msgpack") {
    const parsed = decode(blob) as Partial<EncryptedSecretPayload>;
    if (!(parsed?.iv && parsed?.ciphertext)) {
      throw new Error("Invalid encrypted secret payload.");
    }
    return {
      alg: parsed.alg ?? "AES-GCM",
      iv: ensureUint8Array(parsed.iv),
      ciphertext: ensureUint8Array(parsed.ciphertext),
    };
  }

  const parsed = JSON.parse(
    textDecoder.decode(blob)
  ) as EncryptedSecretPayloadJson;
  if (!(parsed?.iv && parsed?.ciphertext)) {
    throw new Error("Invalid encrypted secret payload.");
  }
  return {
    alg: parsed.alg,
    iv: base64ToBytes(parsed.iv),
    ciphertext: base64ToBytes(parsed.ciphertext),
  };
}

/**
 * Generate a random 256-bit Data Encryption Key (DEK).
 */
export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Encrypt a secret payload with a DEK.
 * The secret is bound to its ID and type via AAD.
 */
export async function encryptWithDek(params: {
  secretId: string;
  secretType: SecretType | string;
  plaintext: Uint8Array;
  dek: Uint8Array;
  envelopeFormat?: EnvelopeFormat;
}): Promise<SecretEnvelope> {
  const format = params.envelopeFormat ?? DEFAULT_ENVELOPE_FORMAT;
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

  const payload: EncryptedSecretPayload = {
    alg: "AES-GCM",
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  };

  return {
    secretId: params.secretId,
    encryptedBlob: serializePayload(payload, format),
    envelopeFormat: format,
  };
}

/**
 * Decrypt a secret payload with a DEK.
 */
export async function decryptWithDek(params: {
  secretId: string;
  secretType: SecretType | string;
  encryptedBlob: Uint8Array;
  dek: Uint8Array;
  envelopeFormat: EnvelopeFormat;
}): Promise<Uint8Array> {
  const payload = parsePayload(params.encryptedBlob, params.envelopeFormat);
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
    ["decrypt"]
  );

  return decryptAesGcm(dekKey, payload, aad);
}
