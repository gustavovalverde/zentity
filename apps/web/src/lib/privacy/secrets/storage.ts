"use client";

/**
 * Secret Blob Storage
 *
 * Handles encrypted blob upload/download via the secrets API.
 * Blobs are stored separately from metadata for efficient large payload handling.
 */

import { fetchBinary } from "@/lib/privacy/utils/binary-transport";

const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Upload an encrypted secret blob.
 *
 * @returns Blob reference, hash, and size for metadata storage
 */
export async function uploadSecretBlob(params: {
  secretId: string;
  secretType: string;
  payload: string | Uint8Array;
}): Promise<{ blobRef: string; blobHash: string; blobSize: number }> {
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "X-Secret-Id": params.secretId,
    "X-Secret-Type": params.secretType,
  });

  const payloadBytes =
    typeof params.payload === "string"
      ? textEncoder.encode(params.payload)
      : params.payload;
  const body = new Uint8Array(payloadBytes.byteLength);
  body.set(payloadBytes);

  const clientHash = await sha256Hex(body);

  const response = await fetchBinary("/api/secrets/blob", {
    method: "POST",
    headers,
    body: body.buffer,
    credentials: "same-origin",
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Failed to upload encrypted secret blob: ${response.status} ${errorBody}`
    );
  }

  const result = (await response.json()) as {
    blobRef: string;
  };

  if (!result?.blobRef) {
    throw new Error("Encrypted secret blob response missing metadata.");
  }

  return {
    blobRef: result.blobRef,
    blobHash: clientHash,
    blobSize: body.byteLength,
  };
}

/**
 * Download an encrypted secret blob.
 *
 * @returns The raw encrypted blob bytes
 */
export async function downloadSecretBlob(
  secretId: string,
  options?: { expectedHash?: string | null }
): Promise<Uint8Array> {
  const response = await fetchBinary(`/api/secrets/blob?secretId=${secretId}`, {
    method: "GET",
    credentials: "same-origin",
  });

  if (response.status === 404) {
    throw new Error(
      "Encrypted secret blob is missing. Please re-secure your encryption keys."
    );
  }

  if (!response.ok) {
    throw new Error("Failed to download encrypted secret blob.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  const expectedHash = options?.expectedHash?.trim().toLowerCase() || null;

  if (expectedHash) {
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== expectedHash) {
      throw new Error(
        "Encrypted secret blob integrity check failed. Please re-secure your encryption keys."
      );
    }
  }

  return bytes;
}
