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
