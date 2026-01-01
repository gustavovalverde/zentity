import "server-only";

import * as crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { passkeyCredentials, users } from "@/lib/db/schema";
import { base64UrlToBytes, bytesToBase64Url } from "@/lib/utils";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Challenge storage using in-memory Map with expiration.
 * In production, consider using Redis or a database table.
 */
const challengeStore = new Map<
  string,
  { challenge: Uint8Array; expiresAt: number }
>();

/**
 * Clean up expired challenges periodically.
 */
function cleanupExpiredChallenges() {
  const now = Date.now();
  for (const [key, value] of challengeStore) {
    if (value.expiresAt < now) {
      challengeStore.delete(key);
    }
  }
}

// Run cleanup every minute
if (typeof setInterval !== "undefined") {
  setInterval(cleanupExpiredChallenges, 60 * 1000);
}

/**
 * Create a new authentication challenge.
 * Returns the challenge ID and challenge bytes.
 */
export function createPasskeyChallenge(): {
  challengeId: string;
  challenge: Uint8Array;
} {
  const challengeId = nanoid();
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  challengeStore.set(challengeId, {
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });

  return { challengeId, challenge };
}

/**
 * Verify and consume a challenge.
 * Returns the challenge bytes if valid, throws if invalid or expired.
 */
export function verifyAndConsumeChallenge(challengeId: string): Uint8Array {
  const stored = challengeStore.get(challengeId);

  if (!stored) {
    throw new Error("Invalid or expired challenge.");
  }

  if (stored.expiresAt < Date.now()) {
    challengeStore.delete(challengeId);
    throw new Error("Challenge expired.");
  }

  // Consume the challenge (one-time use)
  challengeStore.delete(challengeId);

  return stored.challenge;
}

/**
 * Get the RP ID for WebAuthn operations.
 * Uses the hostname from BETTER_AUTH_URL or defaults to localhost.
 */
export function getRelyingPartyId(): string {
  const authUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  try {
    const url = new URL(authUrl);
    return url.hostname;
  } catch {
    return "localhost";
  }
}

/**
 * Get the expected origin for WebAuthn operations.
 */
export function getExpectedOrigin(): string {
  return process.env.BETTER_AUTH_URL || "http://localhost:3000";
}

export interface AssertionData {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
}

/**
 * Verify a WebAuthn assertion.
 * Returns the user ID if verification succeeds.
 */
export async function verifyPasskeyAssertion(params: {
  challengeId: string;
  assertion: AssertionData;
}): Promise<{
  userId: string;
  credentialId: string;
  newCounter: number;
}> {
  const { challengeId, assertion } = params;

  // 1. Look up the credential
  const credential = await db.query.passkeyCredentials.findFirst({
    where: eq(passkeyCredentials.credentialId, assertion.credentialId),
  });

  if (!credential) {
    throw new Error("Unknown credential.");
  }

  // 2. Verify and consume the challenge
  const expectedChallenge = verifyAndConsumeChallenge(challengeId);

  // 3. Decode the assertion data
  const clientDataJSON = base64UrlToBytes(assertion.clientDataJSON);
  const authenticatorData = base64UrlToBytes(assertion.authenticatorData);
  const signature = base64UrlToBytes(assertion.signature);
  const publicKey = base64UrlToBytes(credential.publicKey);

  // 4. Parse and verify clientDataJSON
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON)) as {
    type: string;
    challenge: string;
    origin: string;
  };

  if (clientData.type !== "webauthn.get") {
    throw new Error("Invalid client data type.");
  }

  // Verify challenge matches
  const receivedChallenge = base64UrlToBytes(clientData.challenge);
  if (!timingSafeEqual(receivedChallenge, expectedChallenge)) {
    throw new Error("Challenge mismatch.");
  }

  // Verify origin
  const expectedOrigin = getExpectedOrigin();
  if (clientData.origin !== expectedOrigin) {
    throw new Error(
      `Origin mismatch: expected ${expectedOrigin}, got ${clientData.origin}`,
    );
  }

  // 5. Verify authenticator data
  const rpIdHash = authenticatorData.slice(0, 32);
  const rpIdBytes = new TextEncoder().encode(getRelyingPartyId());
  const expectedRpIdHash = await crypto.subtle.digest("SHA-256", rpIdBytes);
  if (!timingSafeEqual(rpIdHash, new Uint8Array(expectedRpIdHash))) {
    throw new Error("RP ID hash mismatch.");
  }

  // Check user presence flag (bit 0)
  const flags = authenticatorData[32];
  if ((flags & 0x01) === 0) {
    throw new Error("User presence not verified.");
  }

  // Extract counter (bytes 33-36, big-endian)
  const counterView = new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset + 33,
    4,
  );
  const newCounter = counterView.getUint32(0, false);

  // Verify counter is greater than stored counter (replay protection)
  // Cloud-synced passkeys (cloning-resistant authenticators) always return counter = 0.
  // Only enforce counter validation when the stored counter is > 0, indicating
  // the authenticator does increment counters.
  if (credential.counter > 0 && newCounter <= credential.counter) {
    throw new Error(
      "Credential counter did not increase. Possible replay attack.",
    );
  }

  // 6. Verify signature
  // Create a fresh ArrayBuffer to avoid SharedArrayBuffer issues
  const clientDataCopy = Uint8Array.from(clientDataJSON);
  const clientDataHashBuffer = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(clientDataCopy),
  );
  const signedData = new Uint8Array([
    ...authenticatorData,
    ...new Uint8Array(clientDataHashBuffer),
  ]);

  const isValid = await verifySignature(publicKey, signature, signedData);
  if (!isValid) {
    throw new Error("Signature verification failed.");
  }

  // 7. Update counter in database
  await db
    .update(passkeyCredentials)
    .set({
      counter: newCounter,
      lastUsedAt: new Date().toISOString(),
    })
    .where(eq(passkeyCredentials.id, credential.id));

  return {
    userId: credential.userId,
    credentialId: credential.credentialId,
    newCounter,
  };
}

/**
 * Verify a COSE signature using WebCrypto.
 */
async function verifySignature(
  publicKeyBytes: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  try {
    // Parse the COSE public key
    const coseKey = parseCoseKey(publicKeyBytes);

    // Import the public key
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      coseKey.jwk,
      coseKey.algorithm,
      false,
      ["verify"],
    );

    // For ECDSA, we need to convert the signature from ASN.1 DER to raw format
    const rawSignature =
      coseKey.type === "ECDSA"
        ? derToRaw(signature, coseKey.curveSize)
        : signature;

    // Create fresh ArrayBuffer copies to avoid SharedArrayBuffer issues
    const sigCopy = Uint8Array.from(rawSignature);
    const dataCopy = Uint8Array.from(data);

    // Verify the signature
    return await crypto.subtle.verify(
      coseKey.verifyParams,
      cryptoKey,
      toArrayBuffer(sigCopy),
      toArrayBuffer(dataCopy),
    );
  } catch (_error) {
    return false;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Use Uint8Array.from() to create a fresh ArrayBuffer to avoid SharedArrayBuffer issues
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

interface ParsedCoseKey {
  type: "ECDSA" | "RSA" | "EdDSA";
  jwk: JsonWebKey;
  algorithm: EcKeyImportParams | RsaHashedImportParams | AlgorithmIdentifier;
  verifyParams: EcdsaParams | RsaHashedImportParams | AlgorithmIdentifier;
  curveSize: number;
}

/**
 * Parse a COSE public key into JWK format for WebCrypto.
 */
function parseCoseKey(coseKeyBytes: Uint8Array): ParsedCoseKey {
  // COSE keys are CBOR-encoded maps
  // For simplicity, we'll handle the most common formats:
  // - ECDSA with P-256 (ES256, alg: -7)
  // - ECDSA with P-384 (ES384, alg: -35)
  // - RSA with SHA-256 (RS256, alg: -257)
  // - Ed25519 (EdDSA, alg: -8)

  // Simple CBOR parser for COSE keys
  const parsed = decodeCborMap(coseKeyBytes);

  const kty = parsed.get(1); // Key type
  const alg = parsed.get(3); // Algorithm

  if (kty === 2) {
    // EC2 key (ECDSA)
    const crv = parsed.get(-1); // Curve
    const x = parsed.get(-2); // X coordinate
    const y = parsed.get(-3); // Y coordinate

    let curveName: "P-256" | "P-384";
    let curveSize: number;

    if (crv === 1) {
      curveName = "P-256";
      curveSize = 32;
    } else if (crv === 2) {
      curveName = "P-384";
      curveSize = 48;
    } else {
      throw new Error(`Unsupported EC curve: ${crv}`);
    }

    return {
      type: "ECDSA",
      jwk: {
        kty: "EC",
        crv: curveName,
        x: bytesToBase64Url(x as Uint8Array),
        y: bytesToBase64Url(y as Uint8Array),
      },
      algorithm: { name: "ECDSA", namedCurve: curveName },
      verifyParams: { name: "ECDSA", hash: { name: "SHA-256" } },
      curveSize,
    };
  } else if (kty === 3) {
    // RSA key
    const n = parsed.get(-1); // Modulus
    const e = parsed.get(-2); // Exponent

    return {
      type: "RSA",
      jwk: {
        kty: "RSA",
        n: bytesToBase64Url(n as Uint8Array),
        e: bytesToBase64Url(e as Uint8Array),
      },
      algorithm: { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
      verifyParams: { name: "RSASSA-PKCS1-v1_5" },
      curveSize: 0,
    };
  } else if (kty === 1 && alg === -8) {
    // OKP key (EdDSA / Ed25519)
    const x = parsed.get(-2); // Public key

    return {
      type: "EdDSA",
      jwk: {
        kty: "OKP",
        crv: "Ed25519",
        x: bytesToBase64Url(x as Uint8Array),
      },
      algorithm: { name: "Ed25519" },
      verifyParams: { name: "Ed25519" },
      curveSize: 32,
    };
  }

  throw new Error(`Unsupported COSE key type: ${kty}`);
}

/**
 * Simple CBOR decoder for COSE key maps.
 * This is a minimal implementation for WebAuthn public keys.
 */
function decodeCborMap(bytes: Uint8Array): Map<number, unknown> {
  const result = new Map<number, unknown>();
  let offset = 0;

  // Read major type and additional info
  const first = bytes[offset++];
  const majorType = first >> 5;
  const additionalInfo = first & 0x1f;

  if (majorType !== 5) {
    throw new Error("Expected CBOR map");
  }

  // Get map length
  let mapLength: number;
  if (additionalInfo < 24) {
    mapLength = additionalInfo;
  } else if (additionalInfo === 24) {
    mapLength = bytes[offset++];
  } else {
    throw new Error("Unsupported map length encoding");
  }

  // Read key-value pairs
  for (let i = 0; i < mapLength; i++) {
    const [key, keyOffset] = decodeCborValue(bytes, offset);
    offset = keyOffset;
    const [value, valueOffset] = decodeCborValue(bytes, offset);
    offset = valueOffset;
    result.set(key as number, value);
  }

  return result;
}

function decodeCborValue(bytes: Uint8Array, offset: number): [unknown, number] {
  const first = bytes[offset++];
  const majorType = first >> 5;
  const additionalInfo = first & 0x1f;

  let value: number;
  if (additionalInfo < 24) {
    value = additionalInfo;
  } else if (additionalInfo === 24) {
    value = bytes[offset++];
  } else if (additionalInfo === 25) {
    value = (bytes[offset++] << 8) | bytes[offset++];
  } else if (additionalInfo === 26) {
    value =
      (bytes[offset++] << 24) |
      (bytes[offset++] << 16) |
      (bytes[offset++] << 8) |
      bytes[offset++];
  } else {
    throw new Error(`Unsupported additional info: ${additionalInfo}`);
  }

  switch (majorType) {
    case 0: // Unsigned integer
      return [value, offset];
    case 1: // Negative integer
      return [-(value + 1), offset];
    case 2: // Byte string
      return [bytes.slice(offset, offset + value), offset + value];
    case 3: // Text string
      return [
        new TextDecoder().decode(bytes.slice(offset, offset + value)),
        offset + value,
      ];
    default:
      throw new Error(`Unsupported major type: ${majorType}`);
  }
}

/**
 * Convert an ASN.1 DER encoded ECDSA signature to raw format.
 */
function derToRaw(der: Uint8Array, curveSize: number): Uint8Array {
  // DER format: 0x30 [length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  if (der[0] !== 0x30) {
    // Already in raw format?
    return der;
  }

  let offset = 2; // Skip 0x30 and length byte

  // Read R
  if (der[offset++] !== 0x02) throw new Error("Invalid DER signature");
  const rLength = der[offset++];
  let r = der.slice(offset, offset + rLength);
  offset += rLength;

  // Read S
  if (der[offset++] !== 0x02) throw new Error("Invalid DER signature");
  const sLength = der[offset++];
  let s = der.slice(offset, offset + sLength);

  // Remove leading zeros and pad to curve size
  if (r[0] === 0 && r.length > curveSize) r = r.slice(1);
  if (s[0] === 0 && s.length > curveSize) s = s.slice(1);

  const raw = new Uint8Array(curveSize * 2);
  raw.set(r, curveSize - r.length);
  raw.set(s, curveSize * 2 - s.length);

  return raw;
}

/**
 * Timing-safe comparison of two byte arrays.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Register a new passkey credential for a user.
 */
export async function registerPasskeyCredential(params: {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType: "platform" | "cross-platform" | null;
  backedUp: boolean;
  transports: string[];
  name?: string;
}): Promise<{ id: string }> {
  const id = nanoid();

  await db.insert(passkeyCredentials).values({
    id,
    userId: params.userId,
    credentialId: params.credentialId,
    publicKey: params.publicKey,
    counter: params.counter,
    deviceType: params.deviceType,
    backedUp: params.backedUp,
    transports: JSON.stringify(params.transports),
    name: params.name ?? "My Passkey",
    createdAt: new Date().toISOString(),
  });

  return { id };
}

/**
 * Get passkey credentials for a user.
 */
export async function getPasskeyCredentials(userId: string) {
  return db.query.passkeyCredentials.findMany({
    where: eq(passkeyCredentials.userId, userId),
  });
}

/**
 * Get passkey credential by credential ID.
 */
export async function getPasskeyCredentialByCredentialId(credentialId: string) {
  return db.query.passkeyCredentials.findFirst({
    where: eq(passkeyCredentials.credentialId, credentialId),
  });
}

/**
 * Delete a passkey credential.
 */
export async function deletePasskeyCredential(params: {
  userId: string;
  credentialId: string;
}): Promise<{ deleted: boolean }> {
  const result = await db
    .delete(passkeyCredentials)
    .where(eq(passkeyCredentials.credentialId, params.credentialId))
    .returning({ id: passkeyCredentials.id });

  return { deleted: result.length > 0 };
}

/**
 * Rename a passkey credential.
 */
export async function renamePasskeyCredential(params: {
  userId: string;
  credentialId: string;
  name: string;
}): Promise<{ updated: boolean }> {
  const result = await db
    .update(passkeyCredentials)
    .set({ name: params.name })
    .where(eq(passkeyCredentials.credentialId, params.credentialId))
    .returning({ id: passkeyCredentials.id });

  return { updated: result.length > 0 };
}

/**
 * Create a passwordless user account.
 */
export async function createPasswordlessUser(params: {
  email: string;
  name: string;
}): Promise<{ userId: string }> {
  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(users).values({
    id,
    email: params.email,
    name: params.name,
    emailVerified: false,
    passwordlessSignup: true,
    createdAt: now,
    updatedAt: now,
  });

  return { userId: id };
}

/**
 * Get user by email.
 */
export async function getUserByEmail(email: string) {
  return db.query.users.findFirst({
    where: eq(users.email, email),
  });
}

/**
 * Sign a cookie value using HMAC-SHA256, matching Better Auth's cookie signing.
 * Format: <value>.<base64-signature> (URL encoded)
 */
async function signCookieValue(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    encoder.encode(value),
  );

  // Convert signature to base64
  const base64Signature = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  );

  // Format: <value>.<signature>, URL encoded
  return encodeURIComponent(`${value}.${base64Signature}`);
}

/**
 * Create a session for a user after passkey authentication.
 * Creates a session directly in the database and sets a SIGNED session cookie.
 * This integrates with Better Auth's session management.
 *
 * IMPORTANT: Better Auth signs cookies with HMAC-SHA256 using BETTER_AUTH_SECRET.
 * We must sign our cookies the same way for getSession() to recognize them.
 *
 * @param userId - The user's ID
 * @param resHeaders - Response headers to append Set-Cookie to (for tRPC context)
 */
export async function createPasskeySession(
  userId: string,
  resHeaders: Headers,
): Promise<{
  sessionToken: string;
  expiresAt: Date;
}> {
  const { sessions } = await import("@/lib/db/schema");
  const { getBetterAuthSecret } = await import("@/lib/utils/env");

  const sessionId = nanoid();
  const sessionToken = nanoid(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(sessions).values({
    id: sessionId,
    token: sessionToken,
    userId,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  // Sign the session token using the same algorithm as Better Auth
  const secret = getBetterAuthSecret();
  const signedToken = await signCookieValue(sessionToken, secret);

  // Set the session cookie to match Better Auth's format
  // Cookie value must be signed: <token>.<signature> (URL encoded)
  const isProduction = process.env.NODE_ENV === "production";
  const cookieValue = [
    `better-auth.session_token=${signedToken}`,
    "HttpOnly",
    isProduction ? "Secure" : "",
    "SameSite=Lax",
    "Path=/",
    `Expires=${expiresAt.toUTCString()}`,
  ]
    .filter(Boolean)
    .join("; ");

  resHeaders.append("Set-Cookie", cookieValue);

  return {
    sessionToken,
    expiresAt,
  };
}
