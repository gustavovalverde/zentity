/**
 * Client-safe derivation of the 6-character payment confirmation code.
 *
 * The BFF runs this against the canonical `payment_uri` returned by
 * zpay's `/x402/v2/prepare`, ships the resulting code in the CIBA push
 * binding, and the in-page bridge re-runs the same derivation on mount.
 * Two independent computations of the same code defeat URI-swap
 * phishing: the bridge refuses to render its own code if the BFF
 * supplied a different one.
 *
 * The module is intentionally NOT marked `server-only`. The Web Crypto
 * `SubtleCrypto.digest` API is available in modern browsers, Node 20+,
 * and edge runtimes, so the same source runs everywhere. A `node:crypto`
 * fallback covers older Node hosts that do not expose `globalThis.crypto.subtle`.
 */

/**
 * RFC 4648 base32 alphabet (uppercase, no padding). Hard-coded because
 * the encoder needs exactly this 32-character table and threading a
 * dependency would obscure the algorithm.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const CONFIRMATION_CODE_LENGTH = 6;
const BASE32_BITS_PER_CHAR = 5;

function encodeBase32Prefix(digest: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (
    let i = 0;
    i < digest.length && out.length < CONFIRMATION_CODE_LENGTH;
    i++
  ) {
    const byte = digest[i] ?? 0;
    // biome-ignore lint/suspicious/noBitwiseOperators: RFC 4648 base32 byte packing
    value = (value << 8) | byte;
    bits += 8;
    while (
      bits >= BASE32_BITS_PER_CHAR &&
      out.length < CONFIRMATION_CODE_LENGTH
    ) {
      bits -= BASE32_BITS_PER_CHAR;
      // biome-ignore lint/suspicious/noBitwiseOperators: RFC 4648 base32 5-bit extraction
      const idx = (value >> bits) & 0b1_1111;
      out += BASE32_ALPHABET[idx];
    }
  }
  return out;
}

async function digestSha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    // Copy into a fresh ArrayBuffer so we satisfy `BufferSource` without
    // dragging the source array's `ArrayBufferLike` (which may be a
    // SharedArrayBuffer) into the call site.
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    const buffer = await subtle.digest("SHA-256", copy);
    return new Uint8Array(buffer);
  }
  // Older Node hosts that do not expose Web Crypto. The dynamic import
  // keeps `node:crypto` out of browser bundles entirely.
  const { createHash } = await import("node:crypto");
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

/**
 * Derive a 6-character, base32-no-pad, uppercase confirmation code
 * from a prepared `payment_uri`. Deterministic: the same input always
 * produces the same code.
 */
export async function computeUriConfirmationCode(
  paymentUri: string
): Promise<string> {
  const bytes = new TextEncoder().encode(paymentUri);
  const digest = await digestSha256(bytes);
  return encodeBase32Prefix(digest);
}
