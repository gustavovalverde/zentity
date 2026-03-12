import { randomBytes } from "node:crypto";

const BASE64URL_PLUS = /\+/g;
const BASE64URL_SLASH = /\//g;
const BASE64URL_PAD = /=+$/;

function base64url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(BASE64URL_PLUS, "-")
    .replace(BASE64URL_SLASH, "_")
    .replace(BASE64URL_PAD, "");
}

export function generateCodeVerifier(): string {
  const bytes = randomBytes(32);
  return base64url(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
}

export async function computeCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64url(hash);
}

export interface PkceChallenge {
  codeChallenge: string;
  codeChallengeMethod: "S256";
  codeVerifier: string;
}

export async function generatePkce(): Promise<PkceChallenge> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);
  return { codeChallenge, codeChallengeMethod: "S256", codeVerifier };
}
