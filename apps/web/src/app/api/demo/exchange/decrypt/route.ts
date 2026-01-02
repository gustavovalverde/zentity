/**
 * Decrypt PII Route
 *
 * Simulates the exchange decrypting the PII using their private key.
 * Demonstrates the hybrid RSA-OAEP + AES-GCM decryption process.
 */

import { type NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { encryptedPii, privateKey } = await request.json();

    if (!(encryptedPii && privateKey)) {
      return NextResponse.json(
        { error: "encryptedPii and privateKey are required" },
        { status: 400 }
      );
    }

    // Parse the private key
    const privateKeyJwk = JSON.parse(privateKey);

    // Import the private key
    const rsaPrivateKey = await crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"]
    );

    // Decode the encrypted data
    const iv = Uint8Array.from(atob(encryptedPii.iv), (c) => c.charCodeAt(0));
    const encryptedData = Uint8Array.from(
      atob(encryptedPii.encryptedData),
      (c) => c.charCodeAt(0)
    );
    const encryptedAesKey = Uint8Array.from(
      atob(encryptedPii.encryptedAesKey),
      (c) => c.charCodeAt(0)
    );

    // Decrypt the AES key with RSA
    const aesKeyRaw = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      rsaPrivateKey,
      encryptedAesKey
    );

    // Import the AES key
    const aesKey = await crypto.subtle.importKey(
      "raw",
      aesKeyRaw,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    // Decrypt the PII
    const decryptedPii = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      encryptedData
    );

    // Parse the decrypted PII
    const pii = JSON.parse(new TextDecoder().decode(decryptedPii));

    return NextResponse.json({ pii });
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt PII" },
      { status: 500 }
    );
  }
}
