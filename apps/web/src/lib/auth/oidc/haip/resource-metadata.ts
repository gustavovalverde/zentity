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
   * The agent wallet's audience value (its JWK thumbprint). Included so a
   * payment_authorization token request can pin `aud` to the wallet key via
   * the resource indicator (PRD-43 D-5). A bare thumbprint, not a URL, so it
   * is not normalized.
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
  ];
  const audiences = new Set(raw.filter(Boolean).map(normalizeResource));
  if (config.walletAudience) {
    audiences.add(config.walletAudience);
  }
  return [...audiences];
}

export function getProtectedResourceMetadataUrl(): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(TRAILING_SLASHES, "");
  return `${base}/.well-known/oauth-protected-resource`;
}
