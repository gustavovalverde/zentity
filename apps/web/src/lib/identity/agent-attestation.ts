import "server-only";

import {
  decodeProtectedHeader,
  importJWK,
  type JWTPayload,
  jwtVerify,
} from "jose";

import { env } from "@/env";
import { logger } from "@/lib/logging/logger";

import { getHardenedJWKSet } from "./jwks-fetcher";

type AttestationTier = "attested" | "self-declared" | "unverified";

interface AttestationResult {
  provider?: string | undefined;
  tier: AttestationTier;
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

const FAILED: AttestationResult = {
  verified: false,
  tier: "unverified",
};

/**
 * Verify agent attestation per draft-ietf-oauth-attestation-based-client-auth-08.
 * Uses the hardened JWKS fetcher for all remote key resolution.
 */
export async function verifyAgentAttestation(
  attestationJwt: string,
  attestationPopJwt: string | undefined,
  audience: string
): Promise<AttestationResult> {
  const attesters = parseTrustedAttesters();
  if (attesters.length === 0) {
    logger.warn("No trusted attesters configured");
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
    logger.warn(
      { err: err instanceof Error ? err.message : err },
      "Agent attestation verification failed"
    );
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

  const jwks = getHardenedJWKSet(attester.jwksUrl);
  if (!jwks) {
    logger.warn(
      { jwksUrl: attester.jwksUrl },
      "JWKS endpoint rejected by hardening rules"
    );
    return FAILED;
  }

  const { payload } = await jwtVerify(attestationJwt, jwks, {
    audience,
    issuer,
  });

  const cnf = payload.cnf as { jwk?: Record<string, unknown> } | undefined;
  if (!cnf?.jwk) {
    logger.warn("Agent attestation JWT missing cnf.jwk claim");
    return FAILED;
  }

  const popAlg =
    (cnf.jwk.alg as string | undefined) ??
    (cnf.jwk.kty === "OKP" ? "EdDSA" : undefined);
  const popKey = await importJWK(cnf.jwk, popAlg);
  await jwtVerify(popJwt, popKey, { audience });

  const provider = (payload.attester_name as string) ?? attester.issuer;

  return {
    verified: true,
    tier: "attested",
    provider,
    verifiedAt: Math.floor(Date.now() / 1000),
  };
}
