import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { exportJWK, generateKeyPair, importJWK, type JWK } from "jose";

const KEY_PATH = resolve(process.cwd(), ".data/attestation-key.json");

interface AttestationKeyPair {
  privateKey: CryptoKey;
  publicJwk: JWK;
}

let cachedKeyPair: AttestationKeyPair | undefined;

async function getOrCreateKeyPair(): Promise<AttestationKeyPair> {
  if (cachedKeyPair) {
    return cachedKeyPair;
  }

  if (existsSync(KEY_PATH)) {
    const stored = JSON.parse(readFileSync(KEY_PATH, "utf8"));
    const privateKey = await importJWK(stored.privateJwk, "EdDSA");
    cachedKeyPair = {
      privateKey: privateKey as CryptoKey,
      publicJwk: stored.publicJwk,
    };
    return cachedKeyPair;
  }

  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "aether-demo-1";
  publicJwk.use = "sig";

  const privateJwk = await exportJWK(privateKey);
  privateJwk.kid = "aether-demo-1";

  const dir = dirname(KEY_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(KEY_PATH, JSON.stringify({ publicJwk, privateJwk }, null, 2));

  cachedKeyPair = { privateKey, publicJwk };
  return cachedKeyPair;
}

/**
 * Get the JWKS document for the demo attestation provider.
 */
export async function getAttestationJwks(): Promise<{ keys: JWK[] }> {
  const kp = await getOrCreateKeyPair();
  return { keys: [kp.publicJwk] };
}
