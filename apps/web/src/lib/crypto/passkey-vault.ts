"use client";

import { base64ToBytes, bytesToBase64 } from "@/lib/utils";

import { deriveKekFromPrf } from "./key-derivation";
import { decryptAesGcm, encryptAesGcm } from "./symmetric-crypto";

export const PASSKEY_VAULT_VERSION = "v2";
export const WRAP_VERSION = "v1";
export const SECRET_AAD_VERSION = "zentity-secret-aad-v1";
export const WRAP_AAD_VERSION = "zentity-wrap-aad-v1";

export interface EncryptedSecretPayload {
  version: typeof PASSKEY_VAULT_VERSION;
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
}

export interface WrappedDekPayload {
  version: typeof WRAP_VERSION;
  alg: "AES-GCM";
  iv: string;
  ciphertext: string;
}

export interface SecretEnvelope {
  secretId: string;
  encryptedBlob: string;
}

const textEncoder = new TextEncoder();

function encodeAad(parts: string[]): Uint8Array {
  return textEncoder.encode(parts.join("|"));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function serializeEncryptedPayload(payload: EncryptedSecretPayload): string {
  return JSON.stringify(payload);
}

function serializeWrappedDek(payload: WrappedDekPayload): string {
  return JSON.stringify(payload);
}

function parseEncryptedPayload(blob: string): EncryptedSecretPayload {
  const parsed = JSON.parse(blob) as EncryptedSecretPayload;
  if (!parsed || parsed.version !== PASSKEY_VAULT_VERSION) {
    throw new Error("Unsupported encrypted secret version.");
  }
  return parsed;
}

function parseWrappedDek(blob: string): WrappedDekPayload {
  const parsed = JSON.parse(blob) as WrappedDekPayload;
  if (!parsed || parsed.version !== WRAP_VERSION) {
    throw new Error("Unsupported wrapped DEK version.");
  }
  return parsed;
}

export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function encryptSecretWithDek(params: {
  secretId: string;
  secretType: string;
  plaintext: Uint8Array;
  dek: Uint8Array;
}): Promise<SecretEnvelope> {
  const aad = encodeAad([
    SECRET_AAD_VERSION,
    params.secretId,
    params.secretType,
  ]);
  const dekKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(params.dek),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );

  const encrypted = await encryptAesGcm(dekKey, params.plaintext, aad);

  const payload: EncryptedSecretPayload = {
    version: PASSKEY_VAULT_VERSION,
    alg: "AES-GCM",
    iv: bytesToBase64(encrypted.iv),
    ciphertext: bytesToBase64(encrypted.ciphertext),
  };

  return {
    secretId: params.secretId,
    encryptedBlob: serializeEncryptedPayload(payload),
  };
}

export async function decryptSecretWithDek(params: {
  secretId: string;
  secretType: string;
  encryptedBlob: string;
  dek: Uint8Array;
}): Promise<Uint8Array> {
  const payload = parseEncryptedPayload(params.encryptedBlob);
  const aad = encodeAad([
    SECRET_AAD_VERSION,
    params.secretId,
    params.secretType,
  ]);
  const dekKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(params.dek),
    "AES-GCM",
    false,
    ["decrypt"],
  );

  return decryptAesGcm(
    dekKey,
    {
      iv: base64ToBytes(payload.iv),
      ciphertext: base64ToBytes(payload.ciphertext),
    },
    aad,
  );
}

export async function wrapDekWithPrf(params: {
  secretId: string;
  credentialId: string;
  dek: Uint8Array;
  prfOutput: Uint8Array;
}): Promise<string> {
  const aad = encodeAad([
    WRAP_AAD_VERSION,
    params.secretId,
    params.credentialId,
  ]);
  const kek = await deriveKekFromPrf(params.prfOutput);
  const wrapped = await encryptAesGcm(kek, params.dek, aad);

  const payload: WrappedDekPayload = {
    version: WRAP_VERSION,
    alg: "AES-GCM",
    iv: bytesToBase64(wrapped.iv),
    ciphertext: bytesToBase64(wrapped.ciphertext),
  };

  return serializeWrappedDek(payload);
}

export async function unwrapDekWithPrf(params: {
  secretId: string;
  credentialId: string;
  wrappedDek: string;
  prfOutput: Uint8Array;
}): Promise<Uint8Array> {
  const payload = parseWrappedDek(params.wrappedDek);
  const aad = encodeAad([
    WRAP_AAD_VERSION,
    params.secretId,
    params.credentialId,
  ]);
  const kek = await deriveKekFromPrf(params.prfOutput);

  return decryptAesGcm(
    kek,
    {
      iv: base64ToBytes(payload.iv),
      ciphertext: base64ToBytes(payload.ciphertext),
    },
    aad,
  );
}

export async function createSecretEnvelope(params: {
  secretType: string;
  plaintext: Uint8Array;
  prfOutput: Uint8Array;
  credentialId: string;
  prfSalt: Uint8Array;
  secretId?: string;
}): Promise<{
  secretId: string;
  encryptedBlob: string;
  wrappedDek: string;
  prfSalt: string;
}> {
  const secretId = params.secretId ?? crypto.randomUUID();
  const dek = generateDek();
  const secretEnvelope = await encryptSecretWithDek({
    secretId,
    secretType: params.secretType,
    plaintext: params.plaintext,
    dek,
  });
  const wrapper = await wrapDekWithPrf({
    secretId,
    credentialId: params.credentialId,
    dek,
    prfOutput: params.prfOutput,
  });

  return {
    secretId: secretEnvelope.secretId,
    encryptedBlob: secretEnvelope.encryptedBlob,
    wrappedDek: wrapper,
    prfSalt: bytesToBase64(params.prfSalt),
  };
}

export async function decryptSecretEnvelope(params: {
  secretId: string;
  secretType: string;
  encryptedBlob: string;
  wrappedDek: string;
  credentialId: string;
  prfOutput: Uint8Array;
}): Promise<Uint8Array> {
  const dek = await unwrapDekWithPrf({
    secretId: params.secretId,
    credentialId: params.credentialId,
    wrappedDek: params.wrappedDek,
    prfOutput: params.prfOutput,
  });

  return decryptSecretWithDek({
    secretId: params.secretId,
    secretType: params.secretType,
    encryptedBlob: params.encryptedBlob,
    dek,
  });
}
