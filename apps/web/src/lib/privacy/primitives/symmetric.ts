// ---------------------------------------------------------------------------
// Additional authenticated data (AAD) encoding
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

export const SECRET_AAD_CONTEXT = "zentity-secret-aad";
export const WRAP_AAD_CONTEXT = "zentity-wrap-aad";

/**
 * Encode AAD parts with length-prefixing to prevent collision attacks.
 *
 * Without length-prefixes, different inputs can produce identical bytes:
 *   ["ab", "cd"] → "abcd" = ["abc", "d"]
 *
 * With 4-byte big-endian length-prefixes, each part is unambiguous:
 *   ["ab", "cd"] → [0,0,0,2,"ab",0,0,0,2,"cd"] ≠ [0,0,0,3,"abc",0,0,0,1,"d"]
 */
export function encodeAad(parts: string[]): Uint8Array {
  const encodedParts = parts.map((part) => textEncoder.encode(part));
  const totalLength = encodedParts.reduce(
    (sum, bytes) => sum + 4 + bytes.byteLength,
    0
  );
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const bytesOut = new Uint8Array(buffer);
  let offset = 0;

  for (const bytes of encodedParts) {
    view.setUint32(offset, bytes.byteLength, false);
    offset += 4;
    bytesOut.set(bytes, offset);
    offset += bytes.byteLength;
  }

  return bytesOut;
}

// ---------------------------------------------------------------------------
// AES-GCM symmetric encryption
// ---------------------------------------------------------------------------

interface EncryptedBlob {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

const AES_GCM_IV_BYTES = 12;

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

/**
 * Generate a cryptographically secure IV for AES-GCM.
 * AES-GCM requires a unique IV per encryption with the same key.
 */
function generateIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
}

export async function encryptAesGcm(
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Promise<EncryptedBlob> {
  const iv = generateIv();
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

  return { ciphertext: new Uint8Array(ciphertext), iv };
}

export async function decryptAesGcm(
  key: CryptoKey,
  blob: EncryptedBlob,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(blob.iv),
      ...(additionalData
        ? { additionalData: toArrayBuffer(additionalData) }
        : {}),
    },
    key,
    toArrayBuffer(blob.ciphertext)
  );
  return new Uint8Array(plaintext);
}

// ---------------------------------------------------------------------------
// Base64 / base64url encoding
// ---------------------------------------------------------------------------

// `Buffer` is always defined here: Node provides it, and Turbopack resolves the
// free variable to the `buffer` polyfill in every browser bundle and worker.
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function normalizeBase64(base64: string): string {
  const normalized = base64.replaceAll("-", "+").replaceAll("_", "/");
  const padLength = normalized.length % 4;
  if (padLength === 0) {
    return normalized;
  }
  return `${normalized}${"=".repeat(4 - padLength)}`;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll(/=+$/g, "");
}

export function base64UrlToBytes(base64Url: string): Uint8Array {
  return base64ToBytes(normalizeBase64(base64Url));
}

// ---------------------------------------------------------------------------
// Hex encoding
// ---------------------------------------------------------------------------

const HEX_DIGITS = /^[\da-f]+$/i;

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    throw new Error("Expected even-length hex string");
  }
  if (!HEX_DIGITS.test(normalized)) {
    throw new Error("Expected hex string to contain only hex digits");
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// ---------------------------------------------------------------------------
// HKDF-SHA256 (WebCrypto, isomorphic)
// ---------------------------------------------------------------------------

/**
 * Derive `bits` of output keying material with HKDF-SHA256.
 * Salt and info are wire constants for every caller: changing them changes
 * every derived secret.
 */
export async function hkdfBits(
  ikm: Uint8Array,
  params: { bits: number; info: string; salt?: Uint8Array }
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(ikm),
    "HKDF",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(params.salt ?? new Uint8Array(0)),
      info: toArrayBuffer(textEncoder.encode(params.info)),
    },
    key,
    params.bits
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// SHA-256 (WebCrypto, isomorphic)
// ---------------------------------------------------------------------------

export async function sha256Bytes(
  input: Uint8Array | string
): Promise<Uint8Array> {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return new Uint8Array(digest);
}

export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  return bytesToHex(await sha256Bytes(input));
}
