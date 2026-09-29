import "server-only";

import { env } from "@/env";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";

const TRAILING_SLASHES = /\/+$/;

function normalizeResource(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
}

// ---------------------------------------------------------------------------
// RFC 9728 — OAuth Protected Resource metadata
// ---------------------------------------------------------------------------

interface ProtectedResourceConfig {
  appUrl: string;
  authIssuer: string;
  mcpPublicUrl: string;
  oidc4vciCredentialAudience: string;
  rpApiAudience: string;
  /**
   * The agent wallet's audience: an absolute-URI wallet identity (e.g.
   * `urn:zentity:wallet:<jkt>`). Seeded as a resource so a
   * payment_authorization token request can pin `aud` to the wallet via the
   * resource indicator (PRD-43 D-5). A URN carries no trailing slash, so
   * normalization is a no-op and the emitted `aud` equals this value verbatim.
   */
  walletAudience?: string | undefined;
}

export function getProtectedResourceAudiences(
  config: ProtectedResourceConfig
): string[] {
  const raw = [
    config.appUrl,
    config.authIssuer,
    config.mcpPublicUrl,
    config.oidc4vciCredentialAudience,
    config.rpApiAudience,
    config.walletAudience,
  ];
  const present = raw.filter((value): value is string => Boolean(value));
  return [...new Set(present.map(normalizeResource))];
}

const zentityOrigins = [
  normalizeResource(env.NEXT_PUBLIC_APP_URL),
  normalizeResource(getAuthIssuer()),
];

/**
 * Whether a resource indicator names an endpoint Zentity serves itself. User
 * access tokens for these endpoints are opaque reference tokens (ADR
 * privacy/0015).
 */
export function isZentityHostedResource(resource: string): boolean {
  const normalized = normalizeResource(resource);
  return zentityOrigins.some(
    (origin) => normalized === origin || normalized.startsWith(`${origin}/`)
  );
}

/**
 * Prepares the resource indicators of a user token request: each one takes the
 * registered form (no trailing slash, so `https://mcp.example/` names
 * `https://mcp.example`), and Zentity-hosted ones are dropped so the OAuth
 * provider issues an opaque token for them.
 */
export function normalizeUserTokenResources(
  params: Record<string, unknown>
): void {
  const { resource } = params;
  const external = (Array.isArray(resource) ? resource : [resource])
    .filter((value): value is string => typeof value === "string")
    .map(normalizeResource)
    .filter((value) => !isZentityHostedResource(value));
  if (external.length === 0) {
    Reflect.deleteProperty(params, "resource");
  } else {
    params.resource = Array.isArray(resource) ? external : external[0];
  }
}

export function getProtectedResourceMetadataUrl(): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");
  return `${base}/.well-known/oauth-protected-resource`;
}
