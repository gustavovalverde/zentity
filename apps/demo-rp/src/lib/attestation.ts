import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";

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

/**
 * Sign OAuth-Client-Attestation + PoP headers per
 * draft-ietf-oauth-attestation-based-client-auth-08.
 *
 * - `attestation`: JWT signed by the attestation provider, binding the
 *   client's public key via `cnf.jwk`.
 * - `attestationPop`: JWT signed by the client's own private key,
 *   proving possession of the key in `cnf.jwk`.
 */
export async function signAttestationHeaders(
  clientPublicJwk: JWK,
  clientPrivateJwk: JWK,
  issuer: string,
  audience: string
): Promise<{ attestation: string; attestationPop: string }> {
  const providerKp = await getOrCreateKeyPair();

  const attestation = await new SignJWT({
    cnf: { jwk: clientPublicJwk },
    attester_name: "Aether Demo",
  })
    .setProtectedHeader({
      alg: "EdDSA",
      ...(providerKp.publicJwk.kid ? { kid: providerKp.publicJwk.kid } : {}),
      typ: "oauth-client-attestation+jwt",
    })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(providerKp.privateKey);

  const clientKey = await importJWK(clientPrivateJwk, "EdDSA");
  const attestationPop = await new SignJWT({})
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "oauth-client-attestation-pop+jwt",
    })
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(clientKey);

  return { attestation, attestationPop };
}
