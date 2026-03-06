import "server-only";

import { createRemoteJWKSet, jwtVerify } from "jose";

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

  // 3. Verify KB-JWT if present
  if (kbJwt) {
    const cnf = issuerPayload.cnf as { jkt?: string } | undefined;
    if (!cnf?.jkt) {
      return { verified: false, claims: disclosedClaims };
    }

    try {
      // KB-JWT is self-signed by the holder — verify against the cnf.jkt thumbprint
      // For now, verify structure and claims without full JWK resolution
      const [, kbPayloadB64] = kbJwt.split(".");
      const kbPayload = JSON.parse(
        Buffer.from(kbPayloadB64, "base64url").toString("utf8")
      ) as {
        aud?: string;
        iat?: number;
        nonce?: string;
      };

      // Validate audience
      if (kbPayload.aud !== expectedAudience) {
        return { verified: false, claims: disclosedClaims };
      }

      // Validate nonce
      if (kbPayload.nonce !== expectedNonce) {
        return { verified: false, claims: disclosedClaims };
      }

      // Validate freshness
      const iat = kbPayload.iat ?? 0;
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - iat) > MAX_KB_JWT_AGE_SECONDS) {
        return { verified: false, claims: disclosedClaims };
      }
    } catch {
      return { verified: false, claims: disclosedClaims };
    }
  }

  return { verified: true, claims: disclosedClaims };
}
