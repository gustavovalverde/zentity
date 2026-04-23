/**
 * OAuth token validation middleware for MCP HTTP transport.
 *
 * Supports Bearer and DPoP auth schemes. Verifies JWTs locally via JWKS,
 * validates DPoP proofs per RFC 9449, and sets per-request auth context
 * so tool handlers can call requireAuth().
 */

import {
  createJwksTokenVerifier,
  DpopProofVerificationError,
  type TokenVerifier,
  verifyDpopProof,
} from "@zentity/sdk/rp";
import type { JWTPayload, JWTVerifyResult } from "jose";
import { config } from "../config.js";
import {
  getCachedMcpOAuthIssuer,
  getCachedMcpOAuthJwksUri,
} from "../oauth-client.js";

const AUTH_HEADER_RE = /^(Bearer|DPoP)\s+(.+)$/i;

let tokenVerifier: TokenVerifier | undefined;
let tokenVerifierCacheKey: string | undefined;

function getTokenVerifier(): TokenVerifier {
  const jwksUrl =
    getCachedMcpOAuthJwksUri() ?? `${config.zentityUrl}/api/auth/oauth2/jwks`;
  const issuer = getCachedMcpOAuthIssuer() ?? `${config.zentityUrl}/api/auth`;
  const cacheKey = `${issuer}|${jwksUrl}`;

  if (!tokenVerifier || tokenVerifierCacheKey !== cacheKey) {
    tokenVerifierCacheKey = cacheKey;
    tokenVerifier = createJwksTokenVerifier({ issuer, jwksUrl });
  }
  return tokenVerifier;
}

/** Reset cached JWKS (for testing). */
export function resetJwks(): void {
  tokenVerifier = undefined;
  tokenVerifierCacheKey = undefined;
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
  description: string,
  requiredScopes: string[] = []
): TokenAuthError {
  const realm = `Bearer realm="zentity-mcp"`;
  const metadataUrl = `${config.mcpPublicUrl}/.well-known/oauth-protected-resource`;

  const parts = [
    realm,
    `error="${error}"`,
    `error_description="${description}"`,
    `resource_metadata="${metadataUrl}"`,
  ];
  if (requiredScopes.length > 0) {
    parts.push(`scope="${requiredScopes.join(" ")}"`);
  }

  return {
    status,
    wwwAuthenticate: parts.join(", "),
    body: { error, error_description: description },
  };
}

async function validateDpopTokenBinding(input: {
  cnfJkt: string | undefined;
  dpopHeader: string | undefined;
  method: string;
  payload: JWTPayload;
  requiredScopes: string[];
  token: string;
  url: string;
}): Promise<TokenAuthResult | TokenAuthError> {
  if (!input.dpopHeader) {
    return authError(
      401,
      "invalid_token",
      "Missing DPoP proof header",
      input.requiredScopes
    );
  }

  try {
    const dpopResult = await verifyDpopProof({
      accessToken: input.token,
      expectedJkt: input.cnfJkt,
      method: input.method,
      proof: input.dpopHeader,
      url: input.url,
    });
    return {
      payload: input.payload,
      scheme: "DPoP",
      dpopPublicJwk: dpopResult.publicJwk as JsonWebKey,
    };
  } catch (err) {
    const description =
      err instanceof DpopProofVerificationError
        ? err.message
        : "DPoP proof validation failed";
    return authError(
      401,
      "invalid_dpop_proof",
      description,
      input.requiredScopes
    );
  }
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
    return authError(
      401,
      "invalid_request",
      "Missing Authorization header",
      requiredScopes
    );
  }

  const match = AUTH_HEADER_RE.exec(authHeader);
  if (!(match?.[1] && match[2])) {
    return authError(
      401,
      "invalid_request",
      "Malformed Authorization header",
      requiredScopes
    );
  }

  const scheme = match[1].toLowerCase() === "dpop" ? "DPoP" : "Bearer";
  const token = match[2];

  // Verify the access token JWT (issuer + audience)
  let result: JWTVerifyResult<JWTPayload>;
  try {
    result = await getTokenVerifier().verify(token, {
      audience: config.mcpPublicUrl,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Token verification failed";

    if (message.includes("exp") || message.includes("expired")) {
      return authError(
        401,
        "invalid_token",
        "Token has expired",
        requiredScopes
      );
    }
    return authError(401, "invalid_token", message, requiredScopes);
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
      "Sender-constrained token requires DPoP scheme",
      requiredScopes
    );
  }

  if (scheme === "DPoP") {
    return validateDpopTokenBinding({
      cnfJkt,
      dpopHeader,
      method,
      payload,
      requiredScopes,
      token,
      url,
    });
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
    `Token missing required scope(s): ${missing.join(", ")}`,
    required
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

/** Check if the result is an error. */
export function isAuthError(
  result: TokenAuthResult | TokenAuthError
): result is TokenAuthError {
  return "status" in result;
}
