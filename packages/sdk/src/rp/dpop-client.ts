import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

const BASE64URL_PLUS_RE = /\+/g;
const BASE64URL_SLASH_RE = /\//g;
const BASE64URL_PADDING_RE = /=+$/;

export interface DpopKeyPair {
  privateJwk: JWK;
  publicJwk: JWK;
}

export interface DpopClient {
  keyPair: DpopKeyPair;
  proofFor(
    method: string,
    url: string | URL,
    accessToken?: string,
    nonce?: string
  ): Promise<string>;
  withNonceRetry<T>(
    attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
  ): Promise<{ response: Response; result: T }>;
}

function toUrlString(url: string | URL): string {
  return url instanceof URL ? url.toString() : url;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa !== "function") {
    throw new Error("Base64url encoding is unavailable in this runtime");
  }

  return btoa(binary)
    .replace(BASE64URL_PLUS_RE, "-")
    .replace(BASE64URL_SLASH_RE, "_")
    .replace(BASE64URL_PADDING_RE, "");
}

export function encodeStringBase64Url(value: string): string {
  return encodeBase64Url(new TextEncoder().encode(value));
}

async function hashAccessToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return encodeBase64Url(new Uint8Array(digest));
}

async function createClient(keyPair: DpopKeyPair): Promise<DpopClient> {
  const privateKey = await importJWK(keyPair.privateJwk, "ES256");

  return {
    keyPair,
    async proofFor(
      method: string,
      url: string | URL,
      accessToken?: string,
      nonce?: string
    ): Promise<string> {
      const builder = new SignJWT({
        htm: method,
        htu: toUrlString(url),
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID(),
        ...(accessToken ? { ath: await hashAccessToken(accessToken) } : {}),
        ...(nonce ? { nonce } : {}),
      })
        .setIssuedAt()
        .setProtectedHeader({
          alg: "ES256",
          jwk: keyPair.publicJwk,
          typ: "dpop+jwt",
        });

      return builder.sign(privateKey);
    },
    async withNonceRetry<T>(
      attempt: (nonce?: string) => Promise<{ response: Response; result: T }>
    ): Promise<{ response: Response; result: T }> {
      const initial = await attempt();
      if (
        initial.response.status !== 400 &&
        initial.response.status !== 401
      ) {
        return initial;
      }

      const nonce = initial.response.headers.get("DPoP-Nonce");
      if (!nonce) {
        return initial;
      }

      return attempt(nonce);
    },
  };
}

export async function generateDpopKeyPair(): Promise<DpopKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });

  return {
    privateJwk: await exportJWK(privateKey),
    publicJwk: await exportJWK(publicKey),
  };
}

export async function createDpopClient(): Promise<DpopClient> {
  return createClient(await generateDpopKeyPair());
}

export async function createDpopClientFromKeyPair(
  keyPair: DpopKeyPair
): Promise<DpopClient> {
  return createClient(keyPair);
}
