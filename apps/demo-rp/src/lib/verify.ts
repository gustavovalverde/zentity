import "server-only";

import { decodeBase64UrlJsonStrict } from "@zentity/sdk/protocol";
import { createJwksTokenVerifier } from "@zentity/sdk/rp";
import type { JWK } from "jose";
import { importJWK, jwtVerify } from "jose";

import { env } from "@/lib/env";

const MAX_KB_JWT_AGE_SECONDS = 300;

let issuerTokenVerifier: ReturnType<typeof createJwksTokenVerifier> | undefined;
function getIssuerTokenVerifier() {
  issuerTokenVerifier ??= createJwksTokenVerifier({
    jwksUrl: env.ZENTITY_JWKS_URL ?? `${env.ZENTITY_URL}/api/auth/oauth2/jwks`,
  });
  return issuerTokenVerifier;
}

interface VerifyResult {
  claims: Record<string, unknown>;
  verified: boolean;
}

function decodeDisclosures(
  disclosureParts: string[]
): Record<string, unknown> | null {
  const claims: Record<string, unknown> = {};
  for (const disc of disclosureParts) {
    try {
      const decoded = decodeBase64UrlJsonStrict(disc);
      // SD-JWT disclosure format: [salt, claim_name, claim_value]
      if (
        !Array.isArray(decoded) ||
        decoded.length !== 3 ||
        typeof decoded[1] !== "string" ||
        decoded[1].length === 0
      ) {
        return null;
      }
      const claimName = decoded[1];
      if (Object.hasOwn(claims, claimName)) {
        return null;
      }
      claims[claimName] = decoded[2];
    } catch {
      return null;
    }
  }
  return claims;
}

async function verifyKbJwt(
  kbJwt: string,
  issuerPayload: Record<string, unknown>,
  expectedNonce: string,
  expectedAudience: string
): Promise<boolean> {
  // The issuer binds the credential to the holder key it carries as cnf.jwk
  // (SD-JWT VC); the KB-JWT must verify against that key.
  const holderJwk = (issuerPayload.cnf as { jwk?: JWK } | undefined)?.jwk;
  if (!holderJwk) {
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
  // OID4VP + SD-JWT VC mandate a Key Binding JWT in the final segment.
  // A missing or empty KB-JWT defeats holder binding, audience, nonce, and
  // freshness checks, so reject before doing any further work.
  if (!kbJwt) {
    return { verified: false, claims: {} };
  }
  const disclosureParts = parts.slice(1, -1).filter(Boolean);

  let issuerPayload: Record<string, unknown>;
  try {
    const { payload } = await getIssuerTokenVerifier().verify(issuerJwt);
    issuerPayload = payload as Record<string, unknown>;
  } catch {
    return { verified: false, claims: {} };
  }

  const disclosedClaims = decodeDisclosures(disclosureParts);
  if (!disclosedClaims) {
    return { verified: false, claims: {} };
  }

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

  return { verified: true, claims: disclosedClaims };
}
