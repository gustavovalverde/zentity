import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "@/env";

interface AgentClaims {
  agent?: Record<string, unknown>;
  attestation?:
    | { verified: true; issuer: string; verifiedAt: string }
    | undefined;
  task?: Record<string, unknown>;
}

/**
 * Parse agent_claims JSON, strip any self-injected attestation field,
 * verify attestation headers against trusted JWKS, and return normalized claims.
 *
 * Attestation verification is best-effort: if headers are missing, malformed,
 * or verification fails, claims are returned without attestation.
 */
export async function normalizeAgentClaims(
  rawAgentClaims: string | undefined,
  request: Request | undefined
): Promise<string | undefined> {
  if (!rawAgentClaims) {
    return undefined;
  }

  let parsed: AgentClaims;
  try {
    parsed = JSON.parse(rawAgentClaims) as AgentClaims;
  } catch {
    return rawAgentClaims;
  }

  // Strip any self-injected attestation field (security: prevents spoofing)
  parsed.attestation = undefined;

  const attestation = await verifyAttestationHeaders(request);
  if (attestation) {
    parsed.attestation = attestation;
  }

  return JSON.stringify(parsed);
}

async function verifyAttestationHeaders(
  request: Request | undefined
): Promise<AgentClaims["attestation"] | null> {
  if (!request) {
    return null;
  }

  const attestationJwt = request.headers.get("OAuth-Client-Attestation");
  const popJwt = request.headers.get("OAuth-Client-Attestation-PoP");

  if (!(attestationJwt && popJwt)) {
    return null;
  }

  const jwksUrls = parseAttesterUrls();
  if (jwksUrls.length === 0) {
    return null;
  }

  for (const jwksUrl of jwksUrls) {
    try {
      const result = await verifyAgainstJwks(attestationJwt, popJwt, jwksUrl);
      if (result) {
        return result;
      }
    } catch {
      // Try next JWKS URL
    }
  }

  return null;
}

async function verifyAgainstJwks(
  attestationJwt: string,
  popJwt: string,
  jwksUrl: string
): Promise<AgentClaims["attestation"] | null> {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  // Verify the attestation JWT signature
  const { payload: attestationPayload } = await jwtVerify(
    attestationJwt,
    jwks,
    { typ: "oauth-client-attestation+jwt" }
  );

  // Verify the PoP JWT signature
  const { payload: popPayload } = await jwtVerify(popJwt, jwks, {
    typ: "oauth-client-attestation-pop+jwt",
  });

  // Verify the PoP is bound to this attestation via ath claim
  const expectedAth = await sha256base64url(attestationJwt);
  if (popPayload.ath !== expectedAth) {
    return null;
  }

  return {
    verified: true,
    issuer: (attestationPayload.iss as string) ?? jwksUrl,
    verifiedAt: new Date().toISOString(),
  };
}

function parseAttesterUrls(): string[] {
  const raw = env.TRUSTED_AGENT_ATTESTERS;
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const BASE64_PLUS = /\+/g;
const BASE64_SLASH = /\//g;
const BASE64_PAD = /=+$/;

async function sha256base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(BASE64_PLUS, "-")
    .replace(BASE64_SLASH, "_")
    .replace(BASE64_PAD, "");
}
