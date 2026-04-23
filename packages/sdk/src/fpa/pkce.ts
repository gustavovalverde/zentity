import { encodeBase64Url } from "../rp/dpop-client.js";

export interface PkceChallenge {
  codeChallenge: string;
  codeChallengeMethod: "S256";
  codeVerifier: string;
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export async function computeCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return encodeBase64Url(new Uint8Array(hash));
}

export async function generatePkceChallenge(): Promise<PkceChallenge> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);
  return {
    codeChallenge,
    codeChallengeMethod: "S256",
    codeVerifier,
  };
}
