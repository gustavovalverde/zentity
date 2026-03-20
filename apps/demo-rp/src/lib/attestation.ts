import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { exportJWK, generateKeyPair, importJWK, SignJWT } from "jose";

const KEY_PATH = ".data/attestation-key.json";

interface StoredKeyPair {
  privateKey: Record<string, unknown>;
  publicKey: Record<string, unknown>;
}

let cached: CryptoKeyPair | null = null;

async function loadOrCreateKeyPair(): Promise<CryptoKeyPair> {
  if (cached) {
    return cached;
  }

  if (existsSync(KEY_PATH)) {
    const stored = JSON.parse(readFileSync(KEY_PATH, "utf-8")) as StoredKeyPair;
    cached = {
      privateKey: (await importJWK(stored.privateKey, "EdDSA")) as CryptoKey,
      publicKey: (await importJWK(stored.publicKey, "EdDSA")) as CryptoKey,
    };
    return cached;
  }

  const keyPair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const privateJwk = await exportJWK(keyPair.privateKey);
  const publicJwk = await exportJWK(keyPair.publicKey);

  privateJwk.kid = "aether-agent-1";
  privateJwk.alg = "EdDSA";
  privateJwk.use = "sig";
  publicJwk.kid = "aether-agent-1";
  publicJwk.alg = "EdDSA";
  publicJwk.use = "sig";

  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(
    KEY_PATH,
    JSON.stringify({ privateKey: privateJwk, publicKey: publicJwk }, null, 2)
  );

  cached = keyPair;
  return keyPair;
}

/** Returns the public key as a JWK for the JWKS endpoint. */
export async function getPublicJwk(): Promise<
  Record<string, unknown> & { alg: string; kid: string; use: string }
> {
  const { publicKey } = await loadOrCreateKeyPair();
  const jwk = await exportJWK(publicKey);
  return { ...jwk, kid: "aether-agent-1", alg: "EdDSA", use: "sig" };
}

/**
 * Sign attestation headers for a CIBA request.
 *
 * Returns `OAuth-Client-Attestation` (agent identity JWT) and
 * `OAuth-Client-Attestation-PoP` (proof-of-possession JWT bound to it).
 */
export async function signAttestationHeaders(
  clientId: string,
  issuer: string
): Promise<{ attestation: string; pop: string }> {
  const { privateKey } = await loadOrCreateKeyPair();
  const now = Math.floor(Date.now() / 1000);

  const attestation = await new SignJWT({
    sub: clientId,
    agent: {
      name: "Aether AI",
      model: "gpt-4",
      runtime: "demo-rp",
      version: "1.0",
      capabilities: ["shopping", "comparison"],
      oversight: "human-in-the-loop",
    },
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "aether-agent-1",
      typ: "oauth-client-attestation+jwt",
    })
    .setIssuer(issuer)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);

  const pop = await new SignJWT({
    jti: crypto.randomUUID(),
    ath: await sha256base64url(attestation),
  })
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "aether-agent-1",
      typ: "oauth-client-attestation-pop+jwt",
    })
    .setIssuer(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(privateKey);

  return { attestation, pop };
}

const BASE64_PLUS = /\+/g;
const BASE64_SLASH = /\//g;
const BASE64_PAD = /=+$/;

async function sha256base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(BASE64_PLUS, "-")
    .replace(BASE64_SLASH, "_")
    .replace(BASE64_PAD, "");
}
