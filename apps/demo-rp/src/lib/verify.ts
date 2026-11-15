import "server-only";

import { SDJwtInstance, splitSdJwt } from "@sd-jwt/core";
import { decodeBase64UrlJsonStrict } from "@zentity/sdk/protocol";
import { createJwksTokenVerifier } from "@zentity/sdk/rp";
import { compactVerify, importJWK, type JWK } from "jose";

import { env } from "@/lib/env";
import { readDisclosedClaims, sha256Hasher } from "@/lib/sd-jwt";

const MAX_KB_JWT_AGE_SECONDS = 300;

let issuerTokenVerifier: ReturnType<typeof createJwksTokenVerifier> | undefined;
function getIssuerTokenVerifier() {
  issuerTokenVerifier ??= createJwksTokenVerifier({
    jwksUrl: env.ZENTITY_JWKS_URL ?? `${env.ZENTITY_URL}/api/auth/oauth2/jwks`,
  });
  return issuerTokenVerifier;
}

const sdjwt = new SDJwtInstance({
  hasher: sha256Hasher,
  async verifier(data, signature) {
    try {
      await getIssuerTokenVerifier().verify(`${data}.${signature}`);
      return true;
    } catch {
      return false;
    }
  },
  // The issuer binds the credential to the holder key it carries as cnf.jwk
  // (SD-JWT VC); the KB-JWT must verify against that key. It is imported for
  // the KB-JWT's alg: holder JWKs may omit alg, or name Ed25519 for EdDSA.
  async kbVerifier(data, signature, payload) {
    const holderJwk = payload.cnf?.jwk as JWK | undefined;
    if (!holderJwk) {
      return false;
    }
    try {
      await compactVerify(`${data}.${signature}`, (header) =>
        importJWK(holderJwk, header.alg)
      );
      return true;
    } catch {
      return false;
    }
  },
});

/**
 * Verifies an SD-JWT VP token and returns the claims the holder disclosed,
 * or null when the token is rejected.
 *
 * The issuer JWT must verify against the Zentity JWKS and every disclosure
 * must match a digest the issuer signed. The KB-JWT must be signed by the
 * credential's `cnf.jwk` holder key over this exact presentation (`sd_hash`),
 * for this verifier and nonce, within the last five minutes.
 */
export async function verifyVpToken(
  vpToken: string,
  expectedNonce: string,
  expectedAudience: string
): Promise<Record<string, unknown> | null> {
  try {
    // @sd-jwt/core reads disclosures with JSON.parse, which keeps the last of
    // duplicate member names. Reject those so every parser sees one value.
    for (const disclosure of splitSdJwt(vpToken).disclosures) {
      decodeBase64UrlJsonStrict(disclosure);
    }
    const { kb } = await sdjwt.verify(vpToken, {
      keyBindingNonce: expectedNonce,
      expectedKeyBindingAudience: expectedAudience,
      keyBindingMaxAgeSeconds: MAX_KB_JWT_AGE_SECONDS,
    });
    // verify() skips holder binding without a nonce; never accept that.
    if (!kb) {
      return null;
    }
    return await readDisclosedClaims(sdjwt, vpToken);
  } catch {
    return null;
  }
}
