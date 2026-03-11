import crypto from "node:crypto";

import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

import { auth } from "@/lib/auth/auth";

const TOKEN_URL = "http://localhost:3000/api/auth/oauth2/token";

export interface DpopKeyPair {
  jwk: JWK;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export async function createTestDpopKeyPair(): Promise<DpopKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  return { privateKey, publicKey, jwk };
}

export function buildDpopProof(
  keyPair: DpopKeyPair,
  method: string,
  url: string
): Promise<string> {
  return new SignJWT({
    htm: method,
    htu: url,
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({
      alg: "ES256",
      typ: "dpop+jwt",
      jwk: keyPair.jwk,
    })
    .setIssuedAt()
    .sign(keyPair.privateKey);
}

function parseResponseJson(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  // Unwrap better-auth's { response: ... } envelope
  return parsed && typeof parsed === "object" && "response" in parsed
    ? (parsed.response as Record<string, unknown>)
    : parsed;
}

export interface TokenResult {
  dpopKeyPair: DpopKeyPair;
  json: Record<string, unknown>;
  status: number;
}

/**
 * Sends a DPoP-bound token request to the auth handler.
 * Automatically generates a DPoP proof with an ephemeral keypair
 * (or reuses a provided one) and handles the nonce retry.
 */
export async function postTokenWithDpop(
  body: Record<string, string>,
  keyPair?: DpopKeyPair
): Promise<TokenResult> {
  const dpopKeyPair = keyPair ?? (await createTestDpopKeyPair());

  async function attempt(nonce?: string) {
    const proof = await buildDpopProof(dpopKeyPair, "POST", TOKEN_URL);
    // If server gave us a nonce, rebuild with nonce included
    const finalProof = nonce
      ? await new SignJWT({
          htm: "POST",
          htu: TOKEN_URL,
          jti: crypto.randomUUID(),
          iat: Math.floor(Date.now() / 1000),
          nonce,
        })
          .setProtectedHeader({
            alg: "ES256",
            typ: "dpop+jwt",
            jwk: dpopKeyPair.jwk,
          })
          .setIssuedAt()
          .sign(dpopKeyPair.privateKey)
      : proof;

    const response = await auth.handler(
      new Request(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: finalProof,
        },
        body: new URLSearchParams(body),
      })
    );

    const text = await response.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = parseResponseJson(text);
      } catch {
        json = { raw: text };
      }
    }

    return {
      status: response.status,
      json,
      dpopNonce: response.headers.get("DPoP-Nonce"),
    };
  }

  // First attempt
  const first = await attempt();

  // Nonce retry: if server requires a DPoP nonce, retry with it
  if ((first.status === 400 || first.status === 401) && first.dpopNonce) {
    const retry = await attempt(first.dpopNonce);
    return { status: retry.status, json: retry.json, dpopKeyPair };
  }

  return { status: first.status, json: first.json, dpopKeyPair };
}
