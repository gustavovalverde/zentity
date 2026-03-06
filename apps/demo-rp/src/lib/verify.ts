import "server-only";

import type { JWK } from "jose";
import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  importJWK,
  jwtVerify,
} from "jose";

import { env } from "@/lib/env";

const MAX_KB_JWT_AGE_SECONDS = 300;

// Cached JWKS for Zentity issuer signature verification
const zentityJwks = createRemoteJWKSet(
  new URL(env.ZENTITY_JWKS_URL ?? `${env.ZENTITY_URL}/api/auth/pq-jwks`)
);

interface VerifyResult {
  claims: Record<string, unknown>;
  verified: boolean;
}

/**
 * Verifies an SD-JWT VP token locally.
 *
 * 1. Splits the compact SD-JWT into issuer JWT, disclosures, and KB-JWT
 * 2. Verifies the issuer signature against Zentity JWKS
 * 3. Validates KB-JWT (audience, nonce, freshness, holder binding)
 * 4. Extracts disclosed claims
 */
export async function verifyVpToken(
  vpToken: string,
  expectedNonce: string,
  expectedAudience: string
): Promise<VerifyResult> {
  // SD-JWT compact format: <issuer-jwt>~<disclosure1>~<disclosure2>~...~<kb-jwt>
  const parts = vpToken.split("~");
  if (parts.length < 2) {
    return { verified: false, claims: {} };
  }

  const issuerJwt = parts[0];
  const kbJwt = parts.at(-1);
  const disclosureParts = parts.slice(1, -1).filter(Boolean);

  // 1. Verify issuer signature
  let issuerPayload: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(issuerJwt, zentityJwks);
    issuerPayload = payload as Record<string, unknown>;
  } catch {
    return { verified: false, claims: {} };
  }

  // 2. Decode disclosures and extract claims
  const disclosedClaims: Record<string, unknown> = {};
  for (const disc of disclosureParts) {
    try {
      const decoded = JSON.parse(
        Buffer.from(disc, "base64url").toString("utf8")
      );
      // SD-JWT disclosure format: [salt, claim_name, claim_value]
      if (Array.isArray(decoded) && decoded.length >= 3) {
        disclosedClaims[decoded[1] as string] = decoded[2];
      }
    } catch {
      // Skip invalid disclosures
    }
  }

  // 3. Cryptographically verify KB-JWT signature and holder binding
  if (kbJwt) {
    const cnf = issuerPayload.cnf as { jwk?: JWK; jkt?: string } | undefined;
    if (!cnf?.jkt) {
      return { verified: false, claims: disclosedClaims };
    }

    try {
      // Resolve the holder's public key from cnf.jwk or KB-JWT header
      let holderJwk: JWK;
      if (cnf.jwk) {
        holderJwk = cnf.jwk;
      } else {
        const [headerB64] = kbJwt.split(".");
        const header = JSON.parse(
          Buffer.from(headerB64, "base64url").toString("utf8")
        ) as { jwk?: JWK };
        if (!header.jwk) {
          return { verified: false, claims: disclosedClaims };
        }
        holderJwk = header.jwk;
      }

      // Verify JWK thumbprint matches cnf.jkt (holder binding)
      const thumbprint = await calculateJwkThumbprint(holderJwk);
      if (thumbprint !== cnf.jkt) {
        return { verified: false, claims: disclosedClaims };
      }

      // Cryptographically verify KB-JWT signature
      const holderKey = await importJWK(holderJwk);
      const { payload: kbPayload } = await jwtVerify(kbJwt, holderKey, {
        audience: expectedAudience,
        maxTokenAge: MAX_KB_JWT_AGE_SECONDS,
      });

      if (kbPayload.nonce !== expectedNonce) {
        return { verified: false, claims: disclosedClaims };
      }
    } catch {
      return { verified: false, claims: disclosedClaims };
    }
  }

  return { verified: true, claims: disclosedClaims };
}
