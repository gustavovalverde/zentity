/**
 * Exchange Keypair Generation
 *
 * Simulates an exchange generating an RSA keypair for receiving encrypted PII.
 * In production, the exchange would do this on their own infrastructure.
 */

import { NextResponse } from "next/server";

export async function POST() {
  try {
    // Generate RSA-OAEP keypair
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"]
    );

    // Export keys as JWK
    const publicKeyJwk = await crypto.subtle.exportKey(
      "jwk",
      keyPair.publicKey
    );
    const privateKeyJwk = await crypto.subtle.exportKey(
      "jwk",
      keyPair.privateKey
    );

    return NextResponse.json({
      publicKey: JSON.stringify(publicKeyJwk),
      privateKey: JSON.stringify(privateKeyJwk),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate keypair" },
      { status: 500 }
    );
  }
}
