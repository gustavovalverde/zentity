import { base64ToBytes, bytesToBase64 } from "./base64";

function normalizeBase64(base64: string): string {
  const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = normalized.length % 4;
  if (padLength === 0) return normalized;
  return `${normalized}${"=".repeat(4 - padLength)}`;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlToBytes(base64Url: string): Uint8Array {
  return base64ToBytes(normalizeBase64(base64Url));
}
