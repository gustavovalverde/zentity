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
  new URL(env.ZENTITY_JWKS_URL ?? `${env.ZENTITY_URL}/api/auth/oauth2/jwks`)
);

interface VerifyResult {
  claims: Record<string, unknown>;
  verified: boolean;
}

function decodeDisclosures(disclosureParts: string[]): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  for (const disc of disclosureParts) {
    try {
      const decoded = JSON.parse(
        Buffer.from(disc, "base64url").toString("utf8")
      );
      // SD-JWT disclosure format: [salt, claim_name, claim_value]
      if (Array.isArray(decoded) && decoded.length >= 3) {
        claims[decoded[1] as string] = decoded[2];
      }
    } catch {
      // Skip invalid disclosures
    }
  }
  return claims;
}

function resolveHolderJwk(
  cnf: { jwk?: JWK; jkt?: string },
  kbJwt: string
): JWK | null {
  if (cnf.jwk) {
    return cnf.jwk;
  }
  const headerB64 = kbJwt.split(".")[0];
  if (!headerB64) {
    return null;
  }
  const header = JSON.parse(
    Buffer.from(headerB64, "base64url").toString("utf8")
  ) as { jwk?: JWK };
  return header.jwk ?? null;
}

async function verifyKbJwt(
  kbJwt: string,
  issuerPayload: Record<string, unknown>,
  expectedNonce: string,
  expectedAudience: string
): Promise<boolean> {
  const cnf = issuerPayload.cnf as { jwk?: JWK; jkt?: string } | undefined;
  if (!cnf?.jkt) {
    return false;
  }

  const holderJwk = await resolveHolderJwk(cnf, kbJwt);
  if (!holderJwk) {
    return false;
  }

  const thumbprint = await calculateJwkThumbprint(holderJwk);
  if (thumbprint !== cnf.jkt) {
    return false;
  }

  const holderKey = await importJWK(holderJwk);
  const { payload: kbPayload } = await jwtVerify(kbJwt, holderKey, {
    audience: expectedAudience,
    maxTokenAge: MAX_KB_JWT_AGE_SECONDS,
  });

  return kbPayload.nonce === expectedNonce;
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
  const issuerJwt = parts[0];
  if (parts.length < 2 || !issuerJwt) {
    return { verified: false, claims: {} };
  }

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
  const disclosedClaims = decodeDisclosures(disclosureParts);

  // 3. Cryptographically verify KB-JWT signature and holder binding
  if (kbJwt) {
    try {
      const valid = await verifyKbJwt(
        kbJwt,
        issuerPayload,
        expectedNonce,
        expectedAudience
      );
      if (!valid) {
        return { verified: false, claims: disclosedClaims };
      }
    } catch {
      return { verified: false, claims: disclosedClaims };
    }
  }

  return { verified: true, claims: disclosedClaims };
}
