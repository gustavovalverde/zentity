/**
 * Decrypt PII Route
 *
 * Simulates the exchange decrypting the PII using their private key.
 * Demonstrates the hybrid RSA-OAEP + AES-GCM decryption process.
 */

import { type NextRequest, NextResponse } from "next/server";

import { base64ToBytes } from "@/lib/utils/base64";

export async function POST(request: NextRequest) {
  try {
    const { encryptedPii, encryptedPackage, privateKey } = await request.json();

    if (!((encryptedPii || encryptedPackage) && privateKey)) {
      return NextResponse.json(
        {
          error: "encryptedPackage or encryptedPii and privateKey are required",
        },
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

    let iv: Uint8Array;
    let encryptedData: Uint8Array;
    let encryptedAesKey: Uint8Array;

    if (encryptedPackage) {
      const bytes = base64ToBytes(encryptedPackage);
      const rsaKeyBytes = 256;
      encryptedAesKey = bytes.slice(0, rsaKeyBytes);
      iv = bytes.slice(rsaKeyBytes, rsaKeyBytes + 12);
      encryptedData = bytes.slice(rsaKeyBytes + 12);
    } else {
      iv = Uint8Array.from(atob(encryptedPii.iv), (c) => c.charCodeAt(0));
      encryptedData = Uint8Array.from(atob(encryptedPii.encryptedData), (c) =>
        c.charCodeAt(0)
      );
      encryptedAesKey = Uint8Array.from(
        atob(encryptedPii.encryptedAesKey),
        (c) => c.charCodeAt(0)
      );
    }

    // Decrypt the AES key with RSA
    const aesKeyRaw = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      rsaPrivateKey,
      encryptedAesKey.slice().buffer
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
    const ivBuffer = iv.slice().buffer;
    const decryptedPii = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuffer },
      aesKey,
      encryptedData.slice().buffer
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
