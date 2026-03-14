import "server-only";

/**
 * OAuth Access Token Validation
 *
 * Validates OAuth 2.0 bearer tokens for API endpoints that serve RPs.
 * Unlike user session auth, this validates tokens from client_credentials grants.
 */

/**
 * OAuth Access Token Validation
 *
 * Validates OAuth 2.0 bearer tokens for API endpoints that serve RPs.
 * Unlike user session auth, this validates tokens from client_credentials grants.
 */

import { verifyAccessToken } from "better-auth/oauth2";
import { eq } from "drizzle-orm";

import { getAuthIssuer, joinAuthIssuerPath } from "@/lib/auth/issuer";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

export interface OAuthTokenValidationResult {
  clientId?: string;
  error?: string;
  scopes?: string[];
  valid: boolean;
}

const authIssuer = getAuthIssuer();
const RP_API_AUDIENCE = `${authIssuer}/resource/rp-api`;
const jwksUrl = joinAuthIssuerPath(authIssuer, "oauth2/jwks");

/**
 * Extract access token from Authorization header (Bearer or DPoP scheme).
 */
export function extractAccessToken(headers: Headers): string | null {
  const authHeader = headers.get("Authorization");
  if (!authHeader) {
    return null;
  }
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  if (authHeader.startsWith("DPoP ")) {
    return authHeader.slice(5);
  }
  return null;
}

/**
 * Validate an OAuth access token and return client information.
 *
 * This is for RP (client) authentication, not user authentication.
 * The token must be from a client_credentials grant.
 */
export async function validateOAuthAccessToken(
  token: string,
  options?: { requiredScopes?: string[] }
): Promise<OAuthTokenValidationResult> {
  try {
    const payload = await verifyAccessToken(token, {
      verifyOptions: {
        issuer: authIssuer,
        audience: RP_API_AUDIENCE,
      },
      jwksUrl,
      scopes: options?.requiredScopes,
    });

    const clientId =
      (payload.client_id as string | undefined) ??
      (payload.azp as string | undefined);
    if (!clientId) {
      return { valid: false, error: "Missing client_id" };
    }

    // Client credentials tokens should not have a subject
    if (payload.sub) {
      return { valid: false, error: "Not a client credentials token" };
    }

    const scopeString = typeof payload.scope === "string" ? payload.scope : "";
    const scopes = scopeString.split(" ").filter(Boolean);

    const client = await db
      .select({ disabled: oauthClients.disabled })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1)
      .get();

    if (!client) {
      return { valid: false, error: "Client not found" };
    }

    if (client.disabled) {
      return { valid: false, error: "Client disabled" };
    }

    return {
      valid: true,
      clientId,
      scopes,
    };
  } catch {
    return { valid: false, error: "Invalid access token" };
  }
}

/**
 * Compute SHA-256 fingerprint of a public key (algorithm-agnostic).
 */
export async function computeKeyFingerprint(
  publicKeyBase64: string
): Promise<string> {
  const keyBytes = Buffer.from(publicKeyBase64, "base64");
  const hashBuffer = await crypto.subtle.digest("SHA-256", keyBytes);
  return Buffer.from(hashBuffer).toString("hex");
}
