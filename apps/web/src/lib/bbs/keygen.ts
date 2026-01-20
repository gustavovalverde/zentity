/**
 * BBS+ Key Generation
 *
 * Generates BLS12-381 keypairs for BBS+ signatures.
 * Uses @mattrglobal/pairing-crypto WASM implementation.
 */

import type { BbsKeyPair } from "./types";

import { BBS_PUBLIC_KEY_LENGTH, BBS_SECRET_KEY_LENGTH, bbs } from "./crypto";

/**
 * Generate a new BBS+ keypair for signing credentials.
 *
 * @param ikm - Optional input key material (32 bytes). If not provided, random bytes are used.
 * @param keyInfo - Optional key info for domain separation.
 * @returns BBS+ keypair with 32-byte secret key and 96-byte public key.
 */
export async function generateBbsKeyPair(
  ikm?: Uint8Array,
  keyInfo?: Uint8Array
): Promise<BbsKeyPair> {
  const keyPair = await bbs.bls12381_shake256.generateKeyPair({
    ikm: ikm ?? crypto.getRandomValues(new Uint8Array(32)),
    keyInfo: keyInfo ?? new Uint8Array(0),
  });

  return {
    secretKey: keyPair.secretKey,
    publicKey: keyPair.publicKey,
  };
}

/**
 * Derive a BBS+ keypair deterministically from seed material.
 * Useful for deriving issuer keys from a master secret.
 *
 * @param seed - Seed material (minimum 32 bytes)
 * @param context - Domain separation context (e.g., "zentity-bbs-issuer-v1")
 * @returns Deterministically derived BBS+ keypair
 */
export async function deriveBbsKeyPair(
  seed: Uint8Array,
  context: string
): Promise<BbsKeyPair> {
  if (seed.length < 32) {
    throw new Error("Seed must be at least 32 bytes");
  }

  const encoder = new TextEncoder();
  const keyInfo = encoder.encode(context);

  return await generateBbsKeyPair(seed.slice(0, 32), keyInfo);
}

/**
 * Validate a BBS+ public key has correct length.
 */
export function isValidBbsPublicKey(publicKey: Uint8Array): boolean {
  return publicKey.length === BBS_PUBLIC_KEY_LENGTH;
}

/**
 * Validate a BBS+ secret key has correct length.
 */
export function isValidBbsSecretKey(secretKey: Uint8Array): boolean {
  return secretKey.length === BBS_SECRET_KEY_LENGTH;
}

/**
 * Serialize keypair to base64-encoded JSON for storage.
 */
export function serializeBbsKeyPair(keyPair: BbsKeyPair): string {
  return JSON.stringify({
    secretKey: Buffer.from(keyPair.secretKey).toString("base64"),
    publicKey: Buffer.from(keyPair.publicKey).toString("base64"),
  });
}

/**
 * Deserialize keypair from base64-encoded JSON.
 */
export function deserializeBbsKeyPair(serialized: string): BbsKeyPair {
  const parsed = JSON.parse(serialized) as {
    secretKey: string;
    publicKey: string;
  };
  return {
    secretKey: Buffer.from(parsed.secretKey, "base64"),
    publicKey: Buffer.from(parsed.publicKey, "base64"),
  };
}
