import "server-only";

import { APIError } from "better-auth";

const TRAILING_SLASHES = /\/+$/;
const USER_BOUND_GRANT_TYPES = new Set([
  "authorization_code",
  "refresh_token",
  "urn:openid:params:grant-type:ciba",
]);

interface ProtectedResourceConfig {
  appUrl: string;
  authIssuer: string;
  mcpPublicUrl: string;
  oidc4vciCredentialAudience: string;
  rpApiAudience: string;
}

interface ProtectedResourceDescriptor {
  grantTypes?: Set<string>;
}

export interface ResolveProtectedResourceAudienceInput {
  baseURL: string;
  clientId?: string | undefined;
  grantType?: string | undefined;
  resource?: string | string[] | undefined;
  scopes: string[];
}

function normalizeResource(value: string): string {
  return value.replace(TRAILING_SLASHES, "");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeRequestedResources(
  resource: string | string[] | undefined
): string[] | undefined {
  if (typeof resource === "string") {
    return [normalizeResource(resource)];
  }

  if (Array.isArray(resource)) {
    const normalized = resource
      .filter((value): value is string => typeof value === "string")
      .map(normalizeResource);
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

function buildProtectedResourceRegistry(
  config: ProtectedResourceConfig
): Map<string, ProtectedResourceDescriptor> {
  return new Map([
    [normalizeResource(config.appUrl), {}],
    [normalizeResource(config.authIssuer), {}],
    [normalizeResource(config.oidc4vciCredentialAudience), {}],
    [normalizeResource(config.rpApiAudience), {}],
    [
      normalizeResource(config.mcpPublicUrl),
      {
        grantTypes: USER_BOUND_GRANT_TYPES,
      },
    ],
  ]);
}

function invalidRequestedResource(): never {
  throw new APIError("BAD_REQUEST", {
    error: "invalid_request",
    error_description: "requested resource invalid",
  });
}

export function getFirstPartyProtectedResourceAudiences(
  config: Omit<ProtectedResourceConfig, "mcpPublicUrl">
): string[] {
  return dedupe([
    normalizeResource(config.appUrl),
    normalizeResource(config.authIssuer),
    normalizeResource(config.oidc4vciCredentialAudience),
    normalizeResource(config.rpApiAudience),
  ]);
}

export function resolveProtectedResourceAudience(
  config: ProtectedResourceConfig,
  input: ResolveProtectedResourceAudienceInput
): string | string[] | undefined {
  const requested = normalizeRequestedResources(input.resource);
  if (!requested) {
    return undefined;
  }

  const registry = buildProtectedResourceRegistry(config);
  const resolved = requested.map((resource) => {
    const descriptor = registry.get(resource);
    if (!descriptor) {
      return invalidRequestedResource();
    }

    if (
      descriptor.grantTypes &&
      !(input.grantType && descriptor.grantTypes.has(input.grantType))
    ) {
      return invalidRequestedResource();
    }

    return resource;
  });

  return resolved.length === 1 ? resolved[0] : resolved;
}
