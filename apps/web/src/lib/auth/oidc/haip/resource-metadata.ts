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
  ];
  return [...new Set(raw.filter(Boolean).map(normalizeResource))];
}

export function getProtectedResourceMetadataUrl(): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");
  return `${base}/.well-known/oauth-protected-resource`;
}
