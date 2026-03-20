import "server-only";

import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  importJWK,
  type JWTPayload,
  jwtVerify,
} from "jose";

import { env } from "@/env";
import { logger } from "@/lib/logging/logger";

export interface AttestationResult {
  provider?: string | undefined;
  verified: boolean;
  verifiedAt?: number | undefined;
}

interface TrustedAttester {
  issuer: string;
  jwksUrl: string;
}

function parseTrustedAttesters(): TrustedAttester[] {
  const raw = env.TRUSTED_AGENT_ATTESTERS;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => {
      const issuer = new URL(url).origin;
      return { issuer, jwksUrl: url };
    });
}

const FAILED: AttestationResult = { verified: false };

/**
 * Verify agent attestation per draft-ietf-oauth-attestation-based-client-auth-08.
 * Returns { verified: true, provider, verifiedAt } on success, { verified: false } on failure.
 */
export async function verifyAgentAttestation(
  attestationJwt: string,
  attestationPopJwt: string | undefined,
  audience: string
): Promise<AttestationResult> {
  const attesters = parseTrustedAttesters();
  if (attesters.length === 0) {
    return FAILED;
  }

  if (!attestationPopJwt) {
    logger.warn("Agent attestation missing PoP JWT");
    return FAILED;
  }

  try {
    const header = decodeProtectedHeader(attestationJwt);
    const iss = header.iss as string | undefined;

    if (!iss) {
      // Try extracting from payload
      const [, payloadB64] = attestationJwt.split(".");
      if (!payloadB64) {
        return FAILED;
      }
      const payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString()
      ) as JWTPayload;
      return await verifyWithIssuer(
        attestationJwt,
        attestationPopJwt,
        payload.iss,
        audience,
        attesters
      );
    }

    return await verifyWithIssuer(
      attestationJwt,
      attestationPopJwt,
      iss,
      audience,
      attesters
    );
  } catch (err) {
    logger.warn({ err }, "Agent attestation verification failed");
    return FAILED;
  }
}

async function verifyWithIssuer(
  attestationJwt: string,
  popJwt: string,
  issuer: string | undefined,
  audience: string,
  attesters: TrustedAttester[]
): Promise<AttestationResult> {
  if (!issuer) {
    logger.warn("Agent attestation JWT missing issuer");
    return FAILED;
  }

  const attester = attesters.find((a) => a.issuer === issuer);
  if (!attester) {
    logger.warn({ issuer }, "Agent attestation issuer not trusted");
    return FAILED;
  }

  // Verify attestation JWT signature
  const jwks = createRemoteJWKSet(new URL(attester.jwksUrl));
  const { payload } = await jwtVerify(attestationJwt, jwks, {
    audience,
    issuer,
  });

  // Extract cnf claim for PoP verification
  const cnf = payload.cnf as { jwk?: Record<string, unknown> } | undefined;
  if (!cnf?.jwk) {
    logger.warn("Agent attestation JWT missing cnf.jwk claim");
    return FAILED;
  }

  // Verify PoP JWT against cnf key
  const popKey = await importJWK(cnf.jwk);
  await jwtVerify(popJwt, popKey, { audience });

  const provider = (payload.attester_name as string) ?? attester.issuer;

  return {
    verified: true,
    provider,
    verifiedAt: Math.floor(Date.now() / 1000),
  };
}
