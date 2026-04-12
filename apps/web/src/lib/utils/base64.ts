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
