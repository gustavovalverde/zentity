/**
 * Hash-to-field helpers for BN254.
 *
 * We avoid direct 256-bit modulo reduction for cryptographic outputs.
 * Instead, we expand input material to 512 bits with HKDF-SHA256 and then
 * reduce to the BN254 scalar field.
 */

import { bytesToBigInt, numberToHex } from "viem";

import { hexToBytes, hkdfBits } from "@/lib/privacy/primitives/symmetric";

import { BN254_FR_MODULUS } from "./proof-types";

const HKDF_ZERO_SALT = new Uint8Array(32);
const WIDE_OUTPUT_BITS = 512;
const FIELD_BYTES = 32;

export const HASH_TO_FIELD_INFO = {
  DOCUMENT_HASH: "zentity:zk:hash-to-field:document-hash:v1",
  IDENTITY_AUDIENCE: "zentity:zk:hash-to-field:audience:v1",
  IDENTITY_BINDING_SECRET: "zentity:zk:hash-to-field:binding-secret:v1",
  IDENTITY_MSG_SENDER: "zentity:zk:hash-to-field:msg-sender:v1",
  IDENTITY_USER_ID_HASH: "zentity:zk:hash-to-field:user-id-hash:v1",
} as const;

function bigintToFieldHex(value: bigint): string {
  return numberToHex(value % BN254_FR_MODULUS, { size: FIELD_BYTES });
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function hkdfExpand512(
  input: Uint8Array,
  info: string
): Promise<Uint8Array> {
  if (input.byteLength === 0) {
    throw new Error("Hash-to-field input must not be empty");
  }

  return await hkdfBits(input, {
    salt: HKDF_ZERO_SALT,
    info,
    bits: WIDE_OUTPUT_BITS,
  });
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
 * Values must already be canonical field elements; a value at or above the
 * BN254 scalar field modulus is rejected rather than silently reduced, since
 * silent reduction on this security boundary would mask caller bugs.
 */
export function normalizeFieldHex(value: string): string {
  const parsed = BigInt(value);
  if (parsed < BigInt(0)) {
    throw new Error("Field values must be non-negative");
  }
  if (parsed >= BN254_FR_MODULUS) {
    throw new Error("Field value exceeds the BN254 scalar field modulus");
  }
  return bigintToFieldHex(parsed);
}
