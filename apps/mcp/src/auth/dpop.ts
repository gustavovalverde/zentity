import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";
import {
  loadCredentials,
  type StoredCredentials,
  updateCredentials,
} from "./credentials.js";

const BASE64URL_PLUS = /\+/g;
const BASE64URL_SLASH = /\//g;
const BASE64URL_PAD = /=+$/;

export interface DpopKeyPair {
  privateJwk: JWK;
  publicJwk: JWK;
}

export async function getOrCreateDpopKey(
  zentityUrl: string
): Promise<DpopKeyPair> {
  const creds = loadCredentials(zentityUrl);
  if (creds?.dpopJwk && creds.dpopPublicJwk) {
    return { privateJwk: creds.dpopJwk, publicJwk: creds.dpopPublicJwk };
  }

  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);

  updateCredentials(zentityUrl, {
    dpopJwk: privateJwk,
    dpopPublicJwk: publicJwk,
  });
  console.error("[dpop] Generated and persisted new ES256 DPoP keypair");

  return { privateJwk, publicJwk };
}

export async function createDpopProof(
  dpopKey: DpopKeyPair,
  method: string,
  url: string,
  accessToken?: string,
  nonce?: string
): Promise<string> {
  const privateKey = await importJWK(dpopKey.privateJwk, "ES256");

  const payload: Record<string, unknown> = {
    htm: method.toUpperCase(),
    htu: url,
    jti: randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };

  if (nonce) {
    payload.nonce = nonce;
  }

  if (accessToken) {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(accessToken)
    );
    payload.ath = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(BASE64URL_PLUS, "-")
      .replace(BASE64URL_SLASH, "_")
      .replace(BASE64URL_PAD, "");
  }

  return new SignJWT(payload)
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: dpopKey.publicJwk,
    })
    .sign(privateKey);
}

export function extractDpopNonce(response: Response): string | undefined {
  return response.headers.get("dpop-nonce") ?? undefined;
}

export function loadDpopKey(creds: StoredCredentials): DpopKeyPair | undefined {
  if (creds.dpopJwk && creds.dpopPublicJwk) {
    return { privateJwk: creds.dpopJwk, publicJwk: creds.dpopPublicJwk };
  }
  return undefined;
}
