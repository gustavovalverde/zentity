/**
 * OAuth token validation middleware for MCP HTTP transport.
 *
 * Supports Bearer and DPoP auth schemes. Verifies JWTs locally via JWKS,
 * validates DPoP proofs per RFC 9449, and sets per-request auth context
 * so tool handlers can call requireAuth().
 */

import {
  calculateJwkThumbprint,
  createRemoteJWKSet,
  decodeProtectedHeader,
  type JWTPayload,
  type JWTVerifyResult,
  jwtVerify,
} from "jose";
import { config } from "../config.js";
import { getDiscoveredIssuer } from "./discovery.js";

const AUTH_HEADER_RE = /^(Bearer|DPoP)\s+(.+)$/i;
const DPOP_MAX_AGE_S = 300; // 5 minutes
const BASE64URL_PLUS = /\+/g;
const BASE64URL_SLASH = /\//g;
const BASE64URL_PAD = /=+$/;

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    const url = new URL("/api/auth/oauth2/jwks", config.zentityUrl);
    jwks = createRemoteJWKSet(url);
  }
  return jwks;
}

/** Reset cached JWKS (for testing). */
export function resetJwks(): void {
  jwks = undefined;
}

export interface TokenAuthResult {
  /** DPoP public key JWK (only for DPoP scheme) */
  dpopPublicJwk?: JsonWebKey;
  /** Validated JWT payload */
  payload: JWTPayload;
  /** Auth scheme used */
  scheme: "Bearer" | "DPoP";
}

export interface TokenAuthError {
  body: { error: string; error_description: string };
  status: 401 | 403;
  wwwAuthenticate: string;
}

function authError(
  status: 401 | 403,
  error: string,
  description: string
): TokenAuthError {
  const realm = `Bearer realm="zentity-mcp"`;
  const metadataUrl = `${config.mcpPublicUrl}/.well-known/oauth-protected-resource`;

  const parts = [
    realm,
    `error="${error}"`,
    `error_description="${description}"`,
  ];
  if (status === 401) {
    parts.push(`resource_metadata="${metadataUrl}"`);
  }

  return {
    status,
    wwwAuthenticate: parts.join(", "),
    body: { error, error_description: description },
  };
}

/**
 * Validate an OAuth access token from the request.
 * Returns the validated payload and scheme, or an error to send back.
 */
export async function validateToken(
  authHeader: string | undefined,
  dpopHeader: string | undefined,
  method: string,
  url: string,
  requiredScopes: string[] = ["openid"]
): Promise<TokenAuthResult | TokenAuthError> {
  if (!authHeader) {
    return authError(401, "invalid_request", "Missing Authorization header");
  }

  const match = AUTH_HEADER_RE.exec(authHeader);
  if (!(match?.[1] && match[2])) {
    return authError(401, "invalid_request", "Malformed Authorization header");
  }

  const scheme = match[1].toLowerCase() === "dpop" ? "DPoP" : "Bearer";
  const token = match[2];

  // Verify the access token JWT (issuer + audience)
  let result: JWTVerifyResult<JWTPayload>;
  try {
    result = await jwtVerify(token, getJwks(), {
      issuer: getDiscoveredIssuer() ?? `${config.zentityUrl}/api/auth`,
      audience: config.mcpPublicUrl,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Token verification failed";

    if (message.includes("exp") || message.includes("expired")) {
      return authError(401, "invalid_token", "Token has expired");
    }
    return authError(401, "invalid_token", message);
  }

  const payload = result.payload;

  const scopeError = checkScopes(payload, requiredScopes);
  if (scopeError) {
    return scopeError;
  }

  const cnfJkt = extractCnfJkt(payload);

  if (cnfJkt && scheme === "Bearer") {
    return authError(
      401,
      "invalid_token",
      "Sender-constrained token requires DPoP scheme"
    );
  }

  if (scheme === "DPoP") {
    if (!dpopHeader) {
      return authError(401, "invalid_token", "Missing DPoP proof header");
    }

    const dpopResult = await validateDpopProof(
      dpopHeader,
      token,
      method,
      url,
      cnfJkt
    );
    if ("status" in dpopResult) {
      return dpopResult;
    }

    return { payload, scheme, dpopPublicJwk: dpopResult.publicJwk };
  }

  return { payload, scheme };
}

function checkScopes(
  payload: JWTPayload,
  required: string[]
): TokenAuthError | null {
  if (required.length === 0) {
    return null;
  }
  const tokenScopes =
    typeof payload.scope === "string" ? payload.scope.split(" ") : [];
  const missing = required.filter((s) => !tokenScopes.includes(s));
  if (missing.length === 0) {
    return null;
  }
  return authError(
    403,
    "insufficient_scope",
    `Token missing required scope(s): ${missing.join(", ")}`
  );
}

function extractCnfJkt(payload: JWTPayload): string | undefined {
  if (
    payload.cnf &&
    typeof payload.cnf === "object" &&
    "jkt" in payload.cnf &&
    typeof (payload.cnf as Record<string, unknown>).jkt === "string"
  ) {
    return (payload.cnf as Record<string, unknown>).jkt as string;
  }
  return undefined;
}

async function validateDpopProof(
  proof: string,
  accessToken: string,
  expectedMethod: string,
  expectedUrl: string,
  expectedJkt: string | undefined
): Promise<{ publicJwk: JsonWebKey } | TokenAuthError> {
  // Decode the DPoP proof header to get the embedded public key
  let header: { alg?: string; typ?: string; jwk?: JsonWebKey };
  try {
    header = decodeProtectedHeader(proof);
  } catch {
    return authError(401, "invalid_dpop_proof", "Malformed DPoP proof header");
  }

  if (header.typ !== "dpop+jwt") {
    return authError(
      401,
      "invalid_dpop_proof",
      "DPoP proof typ must be dpop+jwt"
    );
  }

  if (!header.jwk) {
    return authError(
      401,
      "invalid_dpop_proof",
      "DPoP proof must contain jwk header"
    );
  }

  // Verify the proof is self-signed by the embedded key
  let proofPayload: JWTPayload;
  try {
    const importKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      header.jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"]
    );
    const verified = await jwtVerify(proof, importKey);
    proofPayload = verified.payload;
  } catch {
    return authError(
      401,
      "invalid_dpop_proof",
      "DPoP proof signature verification failed"
    );
  }

  // Validate htm (HTTP method)
  if (
    typeof proofPayload.htm !== "string" ||
    proofPayload.htm.toUpperCase() !== expectedMethod.toUpperCase()
  ) {
    return authError(
      401,
      "invalid_dpop_proof",
      "DPoP proof htm does not match request method"
    );
  }

  // Validate htu (HTTP URI)
  if (
    typeof proofPayload.htu !== "string" ||
    proofPayload.htu !== expectedUrl
  ) {
    return authError(
      401,
      "invalid_dpop_proof",
      "DPoP proof htu does not match request URI"
    );
  }

  // Validate freshness (iat)
  if (typeof proofPayload.iat !== "number") {
    return authError(401, "invalid_dpop_proof", "DPoP proof missing iat");
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - proofPayload.iat) > DPOP_MAX_AGE_S) {
    return authError(401, "invalid_dpop_proof", "DPoP proof has expired");
  }

  // Validate ath (access token hash)
  const encoder = new TextEncoder();
  const hash = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(accessToken)
  );
  const expectedAth = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(BASE64URL_PLUS, "-")
    .replace(BASE64URL_SLASH, "_")
    .replace(BASE64URL_PAD, "");

  if (proofPayload.ath !== expectedAth) {
    return authError(
      401,
      "invalid_dpop_proof",
      "DPoP proof ath does not match access token"
    );
  }

  // Validate jkt (JWK thumbprint) matches cnf.jkt in the access token
  if (expectedJkt) {
    const thumbprint = await calculateJwkThumbprint(header.jwk, "sha256");
    if (thumbprint !== expectedJkt) {
      return authError(
        401,
        "invalid_dpop_proof",
        "DPoP proof key does not match token cnf.jkt"
      );
    }
  }

  return { publicJwk: header.jwk };
}

/** Check if the result is an error. */
export function isAuthError(
  result: TokenAuthResult | TokenAuthError
): result is TokenAuthError {
  return "status" in result;
}
