// ---------------------------------------------------------------------------
// Additional authenticated data (AAD) encoding
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

export const SECRET_AAD_CONTEXT = "zentity-secret-aad";
export const WRAP_AAD_CONTEXT = "zentity-wrap-aad";
export const RECOVERY_AAD_CONTEXT = "zentity-recovery-dek";

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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
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

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x80_00;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCodePoint(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
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
