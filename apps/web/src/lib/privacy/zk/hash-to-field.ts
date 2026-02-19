/**
 * Hash-to-field helpers for BN254.
 *
 * We avoid direct 256-bit modulo reduction for cryptographic outputs.
 * Instead, we expand input material to 512 bits with HKDF-SHA256 and then
 * reduce to the BN254 scalar field.
 */

import { BN254_FR_MODULUS } from "./proof-types";

const HKDF_ZERO_SALT = new Uint8Array(32);
const WIDE_OUTPUT_BITS = 512;
const FIELD_HEX_BYTES = 32;

export const HASH_TO_FIELD_INFO = {
  DOCUMENT_HASH: "zentity:zk:hash-to-field:document-hash:v1",
  IDENTITY_AUDIENCE: "zentity:zk:hash-to-field:audience:v1",
  IDENTITY_BINDING_SECRET: "zentity:zk:hash-to-field:binding-secret:v1",
  IDENTITY_MSG_SENDER: "zentity:zk:hash-to-field:msg-sender:v1",
  IDENTITY_USER_ID_HASH: "zentity:zk:hash-to-field:user-id-hash:v1",
} as const;

function bigintToFieldHex(value: bigint): string {
  const reduced = value % BN254_FR_MODULUS;
  return `0x${reduced.toString(16).padStart(FIELD_HEX_BYTES * 2, "0")}`;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (const byte of bytes) {
    value = value * BigInt(256) + BigInt(byte);
  }
  return value;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle API is not available");
  }
  return subtle;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    throw new Error("Expected even-length hex string");
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function hkdfExpand512(
  input: Uint8Array,
  info: string
): Promise<Uint8Array> {
  if (input.byteLength === 0) {
    throw new Error("Hash-to-field input must not be empty");
  }

  const subtle = getSubtle();
  const masterKey = await subtle.importKey(
    "raw",
    toArrayBuffer(input),
    "HKDF",
    false,
    ["deriveBits"]
  );

  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(HKDF_ZERO_SALT),
      info: toArrayBuffer(encodeUtf8(info)),
    },
    masterKey,
    WIDE_OUTPUT_BITS
  );

  return new Uint8Array(bits);
}

async function hashToFieldBigIntFromBytes(
  input: Uint8Array,
  info: string
): Promise<bigint> {
  const wide = await hkdfExpand512(input, info);
  return bytesToBigInt(wide) % BN254_FR_MODULUS;
}

async function hashToFieldHexFromBytes(
  input: Uint8Array,
  info: string
): Promise<string> {
  const reduced = await hashToFieldBigIntFromBytes(input, info);
  return bigintToFieldHex(reduced);
}

export async function hashToFieldHexFromHex(
  hex: string,
  info: string
): Promise<string> {
  return await hashToFieldHexFromBytes(hexToBytes(hex), info);
}

export async function hashToFieldHexFromString(
  value: string,
  info: string
): Promise<string> {
  return await hashToFieldHexFromBytes(encodeUtf8(value), info);
}

/**
 * Normalize a field hex value to canonical 32-byte form.
 *
 * Legacy compatibility: if a value is above the modulus, we still reduce
 * modulo BN254 to avoid rejecting older payloads.
 */
export function normalizeFieldHex(value: string): string {
  const parsed = BigInt(value);
  if (parsed < BigInt(0)) {
    throw new Error("Field values must be non-negative");
  }
  return bigintToFieldHex(parsed);
}
