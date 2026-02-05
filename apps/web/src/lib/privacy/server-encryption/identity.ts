import "server-only";

/**
 * Server-Side Identity Encryption
 *
 * Encrypts identity data for OAuth userinfo responses using server-side keys.
 * The encryption key is derived from BETTER_AUTH_SECRET + context (userId, clientId),
 * ensuring:
 * - Different keys per user+RP relationship
 * - Zentity operators cannot decrypt without BETTER_AUTH_SECRET
 * - Data is decryptable by server when serving userinfo requests
 *
 * This is NOT the same as user-controlled encryption (passkey/OPAQUE/wallet).
 * This encryption protects data-at-rest for OAuth flows where user isn't present.
 */

import { decode, encode } from "@msgpack/msgpack";

const HKDF_INFO = "zentity:oauth:identity";

/**
 * Identity fields that can be encrypted for OAuth.
 * Matches OIDC standard claims + Zentity-specific fields.
 */
export interface IdentityFields {
  // OIDC standard claims
  given_name?: string;
  family_name?: string;
  name?: string;
  birthdate?: string; // ISO 8601 date (YYYY-MM-DD)
  address?: {
    formatted?: string;
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
  // Zentity-specific document fields
  document_number?: string;
  document_type?: string;
  issuing_country?: string;
  nationality?: string;
  nationalities?: string[];
}

/**
 * Encrypted identity blob structure for storage.
 */
interface EncryptedIdentityBlob {
  alg: "AES-GCM";
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

function getServerSecret(): Uint8Array {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET not configured");
  }
  return new TextEncoder().encode(secret);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

/**
 * Derive an AES-256-GCM key for a specific user+client pair.
 * Uses HKDF with BETTER_AUTH_SECRET as master key and (userId, clientId) as salt.
 */
async function deriveIdentityKey(
  userId: string,
  clientId: string
): Promise<CryptoKey> {
  const masterKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(getServerSecret()),
    "HKDF",
    false,
    ["deriveKey"]
  );

  // Salt includes both userId and clientId to ensure unique keys per relationship
  const salt = new TextEncoder().encode(`${userId}:${clientId}`);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt,
      hash: "SHA-256",
      info: new TextEncoder().encode(HKDF_INFO),
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt identity fields for server-side storage.
 * Called at OAuth consent time when user is present.
 */
export async function encryptIdentityForServer(
  identity: IdentityFields,
  context: { userId: string; clientId: string }
): Promise<Buffer> {
  const key = await deriveIdentityKey(context.userId, context.clientId);

  // Serialize identity to MessagePack (compact binary)
  const plaintext = encode(identity);

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new Uint8Array(plaintext))
  );

  // Package as blob
  const blob: EncryptedIdentityBlob = {
    alg: "AES-GCM",
    iv,
    ciphertext: new Uint8Array(ciphertext),
  };

  return Buffer.from(encode(blob));
}

/**
 * Decrypt identity fields from server-side storage.
 * Called when serving OAuth userinfo requests.
 */
export async function decryptIdentityFromServer(
  encryptedBlob: Buffer,
  context: { userId: string; clientId: string }
): Promise<IdentityFields> {
  const key = await deriveIdentityKey(context.userId, context.clientId);

  // Parse blob
  const blob = decode(encryptedBlob) as EncryptedIdentityBlob;
  if (blob.alg !== "AES-GCM" || !blob.iv || !blob.ciphertext) {
    throw new Error("Invalid encrypted identity blob");
  }

  // Decrypt
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(new Uint8Array(blob.iv)) },
    key,
    toArrayBuffer(new Uint8Array(blob.ciphertext))
  );

  // Deserialize identity
  return decode(new Uint8Array(plaintext)) as IdentityFields;
}
