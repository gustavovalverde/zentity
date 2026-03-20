import "server-only";

import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

import { env } from "./env";

const ATTESTER_NAME = "Aether Demo";

interface AttestationKeyPair {
  privateKey: CryptoKey;
  publicJwk: JWK;
}

let cachedKeyPair: AttestationKeyPair | undefined;

async function getOrCreateKeyPair(): Promise<AttestationKeyPair> {
  if (cachedKeyPair) {
    return cachedKeyPair;
  }

  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "aether-demo-1";
  publicJwk.use = "sig";

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
 * Sign attestation JWT + PoP JWT for a CIBA bc-authorize request.
 * Returns the two header values per draft-ietf-oauth-attestation-based-client-auth-08.
 */
export async function signAttestationHeaders(audience: string): Promise<{
  attestationJwt: string;
  popJwt: string;
}> {
  const kp = await getOrCreateKeyPair();

  // Generate an ephemeral instance key for PoP
  const instanceKey = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const instancePublicJwk = await exportJWK(instanceKey.publicKey);

  // Attestation JWT — signed by the attester (demo-rp), includes cnf binding
  const issuer = `${env.NEXT_PUBLIC_APP_URL}`;
  const attestationJwt = await new SignJWT({
    attester_name: ATTESTER_NAME,
    cnf: { jwk: instancePublicJwk },
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "aether-demo-1", typ: "jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(kp.privateKey);

  // PoP JWT — signed by the agent instance, proves possession of cnf key
  const popJwt = await new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", typ: "jwt" })
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(instanceKey.privateKey);

  return { attestationJwt, popJwt };
}
