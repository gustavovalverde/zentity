const ML_KEM_768_PUBLIC_KEY_BYTES = 1184;

export function isValidMlKemPublicKey(base64: string): boolean {
  try {
    const bytes = Buffer.from(base64, "base64");
    return bytes.length === ML_KEM_768_PUBLIC_KEY_BYTES;
  } catch {
    return false;
  }
}
