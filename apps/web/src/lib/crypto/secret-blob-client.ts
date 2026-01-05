"use client";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function uploadSecretBlob(params: {
  secretId: string;
  secretType: string;
  payload: string;
  registrationToken?: string;
}): Promise<{ blobRef: string; blobHash: string; blobSize: number }> {
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "X-Secret-Id": params.secretId,
    "X-Secret-Type": params.secretType,
  });
  if (params.registrationToken) {
    headers.set("Authorization", `Bearer ${params.registrationToken}`);
  }

  const data = textEncoder.encode(params.payload);
  const response = await fetch("/api/secrets/blob", {
    method: "POST",
    headers,
    body: data,
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error("Failed to upload encrypted secret blob.");
  }

  const result = (await response.json()) as {
    blobRef: string;
    blobHash: string;
    blobSize: number;
  };

  if (!(result?.blobRef && result?.blobHash)) {
    throw new Error("Encrypted secret blob response missing metadata.");
  }

  return result;
}

export async function downloadSecretBlob(
  secretId: string
): Promise<string> {
  const response = await fetch(`/api/secrets/blob?secretId=${secretId}`, {
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
  return textDecoder.decode(bytes);
}
