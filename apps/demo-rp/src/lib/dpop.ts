import "server-only";

import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";

interface DpopClient {
  proofFor(
    method: string,
    url: string,
    accessToken?: string,
    nonce?: string
  ): Promise<string>;
  publicJwk: JWK;
  withNonceRetry<T>(
    fn: (nonce?: string) => Promise<{ response: Response; result: T }>
  ): Promise<{ response: Response; result: T }>;
}

/**
 * Creates an ephemeral DPoP client with an ES256 (P-256) keypair.
 * Each call generates a fresh keypair — intended for one-shot VCI flows.
 */
export async function createDpopClient(): Promise<DpopClient> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);

  async function proofFor(
    method: string,
    url: string,
    accessToken?: string,
    nonce?: string
  ): Promise<string> {
    const builder = new SignJWT({
      htm: method,
      htu: url,
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      ...(accessToken
        ? { ath: await calculateJwkThumbprint(publicJwk, "sha256") }
        : {}),
      ...(nonce ? { nonce } : {}),
    })
      .setProtectedHeader({
        alg: "ES256",
        typ: "dpop+jwt",
        jwk: publicJwk,
      })
      .setIssuedAt();

    return builder.sign(privateKey);
  }

  async function withNonceRetry<T>(
    fn: (nonce?: string) => Promise<{ response: Response; result: T }>
  ): Promise<{ response: Response; result: T }> {
    const first = await fn(undefined);

    // Check if server requires a nonce (use_dpop_nonce error)
    if (first.response.status === 400) {
      const dpopNonce = first.response.headers.get("DPoP-Nonce");
      if (dpopNonce) {
        return fn(dpopNonce);
      }
    }

    // Also handle 401 with DPoP-Nonce header (RFC 9449 §5.1)
    if (first.response.status === 401) {
      const dpopNonce = first.response.headers.get("DPoP-Nonce");
      if (dpopNonce) {
        return fn(dpopNonce);
      }
    }

    return first;
  }

  return { publicJwk, proofFor, withNonceRetry };
}
