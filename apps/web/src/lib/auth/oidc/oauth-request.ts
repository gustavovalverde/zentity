import "server-only";

/**
 * OAuth Request: signed query verification, request key derivation, resource
 * URI validation (RFC 8707), and access-token validation for RP endpoints.
 *
 * Everything server-side that parses or validates an inbound OAuth/OIDC
 * request payload. Client-side post-auth redirect continuation lives in
 * `oauth-post-login.ts`.
 */

import { createHmac } from "node:crypto";

import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { calculateJwkThumbprint } from "jose";

import { env } from "@/env";
import { verifyAuthIssuedJwt } from "@/lib/auth/jwt-verify";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

// ---------------------------------------------------------------------------
// Signed OAuth query verification
// ---------------------------------------------------------------------------

export async function verifySignedOAuthQuery(
  query: string
): Promise<URLSearchParams> {
  const params = new URLSearchParams(query);
  const sig = params.get("sig");
  const exp = Number(params.get("exp"));
  params.delete("sig");

  const verifySig = await makeSignature(
    params.toString(),
    env.BETTER_AUTH_SECRET
  );
  if (
    !(sig && constantTimeEqual(sig, verifySig)) ||
    Number.isNaN(exp) ||
    new Date(exp * 1000) < new Date()
  ) {
    throw new Error("invalid_signature");
  }

  params.delete("exp");
  return params;
}

export function parseRequestedScopes(queryParams: URLSearchParams): string[] {
  return (queryParams.get("scope") ?? "")
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Canonical OAuth request key (stable hash for idempotency + correlation)
// ---------------------------------------------------------------------------

type CanonicalQueryValue =
  | null
  | string
  | number
  | boolean
  | CanonicalQueryValue[]
  | { [key: string]: CanonicalQueryValue };

function normalizeCanonicalValue(value: unknown): CanonicalQueryValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCanonicalValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalizeCanonicalValue(entry)])
    );
  }

  return String(value);
}

function canonicalizeQueryRecord(
  query: Record<string, unknown>
): Record<string, CanonicalQueryValue> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(
        ([key, value]) => key !== "sig" && key !== "exp" && value !== undefined
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, normalizeCanonicalValue(value)])
  );
}

function canonicalizeOAuthQuery(
  query: URLSearchParams | Record<string, unknown>
): string {
  if (query instanceof URLSearchParams) {
    const record: Record<string, string | string[]> = {};
    const keys = [...new Set(query.keys())].sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      if (key === "sig" || key === "exp") {
        continue;
      }
      const values = query.getAll(key);
      if (values.length === 1) {
        record[key] = values[0] ?? "";
      } else if (values.length > 1) {
        record[key] = values;
      }
    }
    return JSON.stringify(record);
  }

  return JSON.stringify(canonicalizeQueryRecord(query));
}

export function computeOAuthRequestKey(
  query: URLSearchParams | Record<string, unknown>
): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(canonicalizeOAuthQuery(query))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// RFC 8707 — Resource Indicators for OAuth 2.0
// ---------------------------------------------------------------------------

interface ResourceValidationResult {
  error?: string;
  valid: boolean;
}

export function validateResourceUri(
  resource: unknown
): ResourceValidationResult {
  if (typeof resource !== "string" || resource.length === 0) {
    return { valid: false, error: "resource parameter is required" };
  }

  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return { valid: false, error: "resource must be an absolute URI" };
  }

  if (url.hash) {
    return {
      valid: false,
      error: "resource must not contain a fragment component",
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { valid: false, error: "resource must use http or https scheme" };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// OAuth access-token validation (for RP-facing API endpoints)
// ---------------------------------------------------------------------------

export interface OAuthTokenValidationResult {
  clientId?: string;
  error?: string;
  scopes?: string[];
  valid: boolean;
}

const authIssuer = getAuthIssuer();
const RP_API_AUDIENCE = `${authIssuer}/resource/rp-api`;

function audienceIncludes(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") {
    return audience === expected;
  }
  return Array.isArray(audience) && audience.includes(expected);
}

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
 * Validate an OAuth access token from a client_credentials grant (RP auth,
 * not user auth).
 */
export async function validateOAuthAccessToken(
  token: string,
  options?: { requiredScopes?: string[] }
): Promise<OAuthTokenValidationResult> {
  try {
    if (!token.startsWith("eyJ")) {
      return {
        valid: false,
        error: "Opaque client credentials tokens are not supported",
      };
    }

    const payload = await verifyAuthIssuedJwt(token);
    if (!payload) {
      return { valid: false, error: "Invalid access token" };
    }

    if (!audienceIncludes(payload.aud, RP_API_AUDIENCE)) {
      return { valid: false, error: "Invalid access token" };
    }

    if (payload.sub) {
      return { valid: false, error: "Not a client credentials token" };
    }

    const clientId =
      (payload.client_id as string | undefined) ??
      (payload.azp as string | undefined);
    if (!clientId) {
      return { valid: false, error: "Missing client_id" };
    }

    const scopes =
      typeof payload.scope === "string"
        ? payload.scope.split(" ").filter(Boolean)
        : [];

    if (
      options?.requiredScopes &&
      !options.requiredScopes.every((scope) => scopes.includes(scope))
    ) {
      return { valid: false, error: "Missing required scope" };
    }

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

export async function computeKeyFingerprint(
  publicKeyBase64: string
): Promise<string> {
  const keyBytes = Buffer.from(publicKeyBase64, "base64");
  const hashBuffer = await crypto.subtle.digest("SHA-256", keyBytes);
  return Buffer.from(hashBuffer).toString("hex");
}

export function computeJwkThumbprint(rawJwk: string): Promise<string> {
  const jwk = JSON.parse(rawJwk) as Record<string, unknown>;
  return calculateJwkThumbprint(jwk);
}
