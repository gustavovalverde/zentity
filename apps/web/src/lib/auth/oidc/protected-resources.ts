import "server-only";

const TRAILING_SLASHES = /\/+$/;

interface ProtectedResourceConfig {
  appUrl: string;
  authIssuer: string;
  mcpPublicUrl: string;
  oidc4vciCredentialAudience: string;
  rpApiAudience: string;
}

function normalizeResource(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
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
