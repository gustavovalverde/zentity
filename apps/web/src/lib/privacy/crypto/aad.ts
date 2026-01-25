const textEncoder = new TextEncoder();

export const SECRET_AAD_CONTEXT = "zentity-secret-aad";
export const WRAP_AAD_CONTEXT = "zentity-wrap-aad";

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
