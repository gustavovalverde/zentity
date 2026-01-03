/**
 * Test utilities for passkey authentication.
 * Provides builders for WebAuthn test data including COSE keys,
 * authenticator data, and assertions.
 */
import crypto from "node:crypto";

import { db } from "@/lib/db/connection";
import { passkeyCredentials } from "@/lib/db/schema/auth";
import { bytesToBase64Url } from "@/lib/utils/base64url";

/**
 * CBOR encoding helpers for COSE keys.
 */
function encodeCborUint(value: number): Uint8Array {
  if (value < 0) {
    // Negative integer: major type 1
    const absValue = Math.abs(value) - 1;
    if (absValue < 24) {
      return new Uint8Array([0x20 | absValue]);
    }
    if (absValue < 256) {
      return new Uint8Array([0x38, absValue]);
    }
    throw new Error("Negative value too large");
  }
  if (value < 24) {
    return new Uint8Array([value]);
  }
  if (value < 256) {
    return new Uint8Array([0x18, value]);
  }
  if (value < 65_536) {
    return new Uint8Array([0x19, (value >> 8) & 0xff, value & 0xff]);
  }
  throw new Error("Value too large");
}

function encodeCborBytes(bytes: Uint8Array): Uint8Array {
  let header: Uint8Array;
  if (bytes.length < 24) {
    header = new Uint8Array([0x40 | bytes.length]);
  } else if (bytes.length < 256) {
    header = new Uint8Array([0x58, bytes.length]);
  } else {
    header = new Uint8Array([
      0x59,
      (bytes.length >> 8) & 0xff,
      bytes.length & 0xff,
    ]);
  }
  return new Uint8Array([...header, ...bytes]);
}

function encodeCborMap(entries: [number, Uint8Array | number][]): Uint8Array {
  const mapHeader =
    entries.length < 24
      ? new Uint8Array([0xa0 | entries.length])
      : new Uint8Array([0xb8, entries.length]);

  const parts: Uint8Array[] = [mapHeader];
  for (const [key, value] of entries) {
    parts.push(encodeCborUint(key));
    if (typeof value === "number") {
      parts.push(encodeCborUint(value));
    } else {
      parts.push(encodeCborBytes(value));
    }
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export interface TestKeyPair {
  publicKey: crypto.webcrypto.CryptoKey;
  privateKey: crypto.webcrypto.CryptoKey;
  cosePublicKey: Uint8Array;
  cosePublicKeyBase64: string;
}

/**
 * Generate an ECDSA P-256 key pair for testing.
 * Returns the CryptoKey pair and COSE-encoded public key.
 */
export async function createTestKeyPair(
  curve: "P-256" | "P-384" = "P-256"
): Promise<TestKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: curve },
    true, // extractable for testing
    ["sign", "verify"]
  );

  // Export to JWK to get raw coordinates
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  if (!(jwk.x && jwk.y)) {
    throw new Error("Missing EC coordinates in JWK");
  }

  // Decode base64url coordinates
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");

  // Create COSE key
  // EC2 key type: kty=2, alg=-7 (ES256) or -35 (ES384), crv=1 (P-256) or 2 (P-384)
  const crv = curve === "P-256" ? 1 : 2;
  const alg = curve === "P-256" ? -7 : -35;

  const cosePublicKey = encodeCborMap([
    [1, 2], // kty: EC2
    [3, alg], // alg: ES256 or ES384
    [-1, crv], // crv: P-256 or P-384
    [-2, new Uint8Array(x)], // x coordinate
    [-3, new Uint8Array(y)], // y coordinate
  ]);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    cosePublicKey,
    cosePublicKeyBase64: bytesToBase64Url(cosePublicKey),
  };
}

export interface AuthenticatorDataParams {
  rpIdHash: Uint8Array;
  counter: number;
  flags?: {
    up?: boolean; // User Present
    uv?: boolean; // User Verified
    be?: boolean; // Backup Eligibility
    bs?: boolean; // Backup State
  };
}

/**
 * Create authenticator data with configurable flags and counter.
 */
export function createTestAuthenticatorData(
  params: AuthenticatorDataParams
): Uint8Array {
  const flags = params.flags ?? { up: true, uv: true };

  // Build flags byte
  let flagsByte = 0;
  if (flags.up) {
    flagsByte |= 0x01; // Bit 0: User Present
  }
  if (flags.uv) {
    flagsByte |= 0x04; // Bit 2: User Verified
  }
  if (flags.be) {
    flagsByte |= 0x08; // Bit 3: Backup Eligibility
  }
  if (flags.bs) {
    flagsByte |= 0x10; // Bit 4: Backup State
  }

  // Authenticator data structure:
  // - 32 bytes: rpIdHash
  // - 1 byte: flags
  // - 4 bytes: counter (big-endian)
  const result = new Uint8Array(37);
  result.set(params.rpIdHash, 0);
  result[32] = flagsByte;

  // Counter as big-endian 32-bit
  const view = new DataView(result.buffer, 33, 4);
  view.setUint32(0, params.counter, false);

  return result;
}

export interface ClientDataParams {
  challenge: string; // base64url-encoded
  origin: string;
  type?: "webauthn.get" | "webauthn.create";
}

/**
 * Create client data JSON for testing.
 */
export function createTestClientDataJSON(params: ClientDataParams): string {
  const clientData = {
    type: params.type ?? "webauthn.get",
    challenge: params.challenge,
    origin: params.origin,
    crossOrigin: false,
  };
  return JSON.stringify(clientData);
}

/**
 * Sign data using an ECDSA private key.
 * Returns raw signature (R || S format, not DER).
 */
export async function signTestData(
  privateKey: crypto.webcrypto.CryptoKey,
  data: Uint8Array
): Promise<Uint8Array> {
  // Create a fresh ArrayBuffer to avoid SharedArrayBuffer issues
  const dataBuffer = Uint8Array.from(data).buffer as ArrayBuffer;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    privateKey,
    dataBuffer
  );
  return new Uint8Array(signature);
}

/**
 * Convert raw ECDSA signature to DER format.
 * WebAuthn authenticators return DER-encoded signatures.
 */
export function rawToDer(raw: Uint8Array, curveSize: number): Uint8Array {
  const r = raw.slice(0, curveSize);
  const s = raw.slice(curveSize);

  // Add leading zero if high bit is set (to prevent being interpreted as negative)
  const rPadded = r[0] >= 0x80 ? new Uint8Array([0, ...r]) : r;
  const sPadded = s[0] >= 0x80 ? new Uint8Array([0, ...s]) : s;

  const totalLength = 2 + rPadded.length + 2 + sPadded.length;
  const der = new Uint8Array(2 + totalLength);

  let offset = 0;
  der[offset++] = 0x30; // SEQUENCE
  der[offset++] = totalLength;
  der[offset++] = 0x02; // INTEGER (R)
  der[offset++] = rPadded.length;
  der.set(rPadded, offset);
  offset += rPadded.length;
  der[offset++] = 0x02; // INTEGER (S)
  der[offset++] = sPadded.length;
  der.set(sPadded, offset);

  return der;
}

export interface AssertionData {
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
}

export interface CreateAssertionParams {
  credentialId: string;
  challenge: Uint8Array;
  origin: string;
  rpId: string;
  counter: number;
  privateKey: crypto.webcrypto.CryptoKey;
  userHandle?: string | null;
  flags?: AuthenticatorDataParams["flags"];
}

/**
 * Create a complete WebAuthn assertion for testing.
 * Signs the authenticator data and client data hash with the private key.
 */
export async function createTestAssertion(
  params: CreateAssertionParams
): Promise<AssertionData> {
  // 1. Compute RP ID hash
  const rpIdBytes = new TextEncoder().encode(params.rpId);
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", rpIdBytes)
  );

  // 2. Create authenticator data
  const authenticatorData = createTestAuthenticatorData({
    rpIdHash,
    counter: params.counter,
    flags: params.flags ?? { up: true, uv: true },
  });

  // 3. Create client data
  const challengeBase64 = bytesToBase64Url(params.challenge);
  const clientDataJSON = createTestClientDataJSON({
    challenge: challengeBase64,
    origin: params.origin,
    type: "webauthn.get",
  });
  const clientDataBytes = new TextEncoder().encode(clientDataJSON);

  // 4. Compute client data hash
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", clientDataBytes)
  );

  // 5. Sign authenticatorData || clientDataHash
  const signedData = new Uint8Array([...authenticatorData, ...clientDataHash]);
  const rawSignature = await signTestData(params.privateKey, signedData);

  // 6. Convert to DER format (WebAuthn uses DER)
  const derSignature = rawToDer(rawSignature, 32);

  return {
    credentialId: params.credentialId,
    clientDataJSON: bytesToBase64Url(clientDataBytes),
    authenticatorData: bytesToBase64Url(authenticatorData),
    signature: bytesToBase64Url(derSignature),
    userHandle: params.userHandle ?? null,
  };
}

export interface CreateTestCredentialParams {
  userId: string;
  credentialId?: string;
  publicKey?: string;
  counter?: number;
  name?: string;
  deviceType?: "platform" | "cross-platform" | null;
  backedUp?: boolean;
}

/**
 * Create a passkey credential in the test database.
 * Returns the credential ID.
 */
export async function createTestPasskeyCredential(
  params: CreateTestCredentialParams
): Promise<string> {
  const id = crypto.randomUUID();
  const credentialId =
    params.credentialId ??
    bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

  await db
    .insert(passkeyCredentials)
    .values({
      id,
      userId: params.userId,
      credentialId,
      publicKey: params.publicKey ?? bytesToBase64Url(new Uint8Array(65)), // Placeholder
      counter: params.counter ?? 0,
      deviceType: params.deviceType ?? "platform",
      backedUp: params.backedUp ?? false,
      transports: JSON.stringify(["internal"]),
      name: params.name ?? "Test Passkey",
      createdAt: new Date().toISOString(),
    })
    .run();

  return credentialId;
}

/**
 * Create a full test passkey credential with a real key pair.
 * Returns everything needed for signing assertions.
 */
export async function createTestPasskeyCredentialWithKeyPair(
  params: Omit<CreateTestCredentialParams, "publicKey">
): Promise<{
  credentialId: string;
  keyPair: TestKeyPair;
}> {
  const keyPair = await createTestKeyPair();
  const credentialId = await createTestPasskeyCredential({
    ...params,
    publicKey: keyPair.cosePublicKeyBase64,
  });

  return { credentialId, keyPair };
}
