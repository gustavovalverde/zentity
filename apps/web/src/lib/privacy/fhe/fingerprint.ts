/**
 * Compute a SHA-256 fingerprint of an FHE public key.
 * Used to detect server-side key substitution.
 */
export async function computePublicKeyFingerprint(
  publicKey: Uint8Array
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(publicKey).buffer
  );
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
