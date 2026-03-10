import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { decryptAesGcm, encryptAesGcm } from "@/lib/privacy/primitives/aes-gcm";

const RELEASE_HANDLE_BYTES = 32;

export interface SealedApproval {
  encryptedPii: string;
  encryptionIv: string;
  releaseHandle: string;
  releaseHandleHash: string;
}

/**
 * Generate a release handle and encrypt PII with it.
 *
 * Returns the handle (base64url — goes into the access token),
 * its SHA-256 hash (hex — stored in DB for lookup), and the
 * AES-GCM ciphertext + IV (base64 — stored in DB).
 */
export async function sealApprovalPii(
  piiJson: string
): Promise<SealedApproval> {
  const handleBytes = randomBytes(RELEASE_HANDLE_BYTES);
  const releaseHandle = handleBytes.toString("base64url");
  const releaseHandleHash = createHash("sha256")
    .update(handleBytes)
    .digest("hex");

  const key = await crypto.subtle.importKey(
    "raw",
    handleBytes,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const { ciphertext, iv } = await encryptAesGcm(
    key,
    new TextEncoder().encode(piiJson)
  );

  return {
    encryptedPii: Buffer.from(ciphertext).toString("base64"),
    encryptionIv: Buffer.from(iv).toString("base64"),
    releaseHandle,
    releaseHandleHash,
  };
}

/**
 * Decrypt PII using the release handle extracted from the access token.
 */
export async function unsealApprovalPii(
  releaseHandle: string,
  encryptedPii: string,
  encryptionIv: string
): Promise<string> {
  const handleBytes = Buffer.from(releaseHandle, "base64url");

  const key = await crypto.subtle.importKey(
    "raw",
    handleBytes,
    "AES-GCM",
    false,
    ["decrypt"]
  );

  const plaintext = await decryptAesGcm(key, {
    ciphertext: new Uint8Array(Buffer.from(encryptedPii, "base64")),
    iv: new Uint8Array(Buffer.from(encryptionIv, "base64")),
  });

  return new TextDecoder().decode(plaintext);
}

/**
 * Compute the SHA-256 hash of a release handle for DB lookup.
 */
export function hashReleaseHandle(releaseHandle: string): string {
  const handleBytes = Buffer.from(releaseHandle, "base64url");
  return createHash("sha256").update(handleBytes).digest("hex");
}
