import "server-only";

import { env } from "@/env";

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

export function getProtectedResourceMetadataUrl(): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");
  return `${base}/.well-known/oauth-protected-resource`;
}
