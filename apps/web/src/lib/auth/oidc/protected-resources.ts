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

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function getProtectedResourceAudiences(
  config: ProtectedResourceConfig
): string[] {
  return dedupe([
    normalizeResource(config.appUrl),
    normalizeResource(config.authIssuer),
    normalizeResource(config.mcpPublicUrl),
    normalizeResource(config.oidc4vciCredentialAudience),
    normalizeResource(config.rpApiAudience),
  ]);
}
