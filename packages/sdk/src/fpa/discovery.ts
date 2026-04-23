const DEFAULT_DISCOVERY_TTL_MS = 5 * 60 * 1000;

export interface FirstPartyAuthDiscoveryDocument {
  authorization_challenge_endpoint?: string;
  authorization_endpoint: string;
  backchannel_authentication_endpoint?: string;
  client_id_metadata_document_supported?: boolean;
  dpop_signing_alg_values_supported?: string[];
  issuer: string;
  jwks_uri?: string;
  pushed_authorization_request_endpoint?: string;
  registration_endpoint?: string;
  require_pushed_authorization_requests?: boolean;
  token_endpoint: string;
}

export interface CreateDiscoveryResolverOptions {
  discoveryTtlMs?: number;
  fetch?: typeof globalThis.fetch;
  issuerUrl: string | URL;
}

interface CachedDiscoveryDocument {
  document: FirstPartyAuthDiscoveryDocument;
  expiresAt: number;
}

function toUrl(value: string | URL): URL {
  return value instanceof URL ? value : new URL(value);
}

function resolveDiscoveryUrl(issuerUrl: string | URL): URL {
  return new URL("/.well-known/openid-configuration", toUrl(issuerUrl));
}

function readOptionalString(
  source: Record<string, unknown>,
  key: string
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalBoolean(
  source: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalStringArray(
  source: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = source[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }

  return value;
}

function requireString(
  source: Record<string, unknown>,
  key: string
): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`OpenID discovery response missing ${key}`);
  }
  return value;
}

function parseDiscoveryDocument(
  body: unknown
): FirstPartyAuthDiscoveryDocument {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("OpenID discovery response is not an object");
  }

  const document = body as Record<string, unknown>;
  const registrationEndpoint = readOptionalString(document, "registration_endpoint");
  const challengeEndpoint = readOptionalString(
    document,
    "authorization_challenge_endpoint"
  );
  const backchannelEndpoint = readOptionalString(
    document,
    "backchannel_authentication_endpoint"
  );
  const pushedAuthorizationRequestEndpoint = readOptionalString(
    document,
    "pushed_authorization_request_endpoint"
  );
  const jwksUri = readOptionalString(document, "jwks_uri");
  const dpopSigningAlgorithms = readOptionalStringArray(
    document,
    "dpop_signing_alg_values_supported"
  );
  const requirePushedAuthorizationRequests = readOptionalBoolean(
    document,
    "require_pushed_authorization_requests"
  );
  const clientMetadataDocumentSupported = readOptionalBoolean(
    document,
    "client_id_metadata_document_supported"
  );

  return {
    issuer: requireString(document, "issuer"),
    token_endpoint: requireString(document, "token_endpoint"),
    authorization_endpoint: requireString(document, "authorization_endpoint"),
    ...(registrationEndpoint ? { registration_endpoint: registrationEndpoint } : {}),
    ...(challengeEndpoint
      ? { authorization_challenge_endpoint: challengeEndpoint }
      : {}),
    ...(backchannelEndpoint
      ? { backchannel_authentication_endpoint: backchannelEndpoint }
      : {}),
    ...(pushedAuthorizationRequestEndpoint
      ? {
          pushed_authorization_request_endpoint: pushedAuthorizationRequestEndpoint,
        }
      : {}),
    ...(jwksUri ? { jwks_uri: jwksUri } : {}),
    ...(dpopSigningAlgorithms
      ? { dpop_signing_alg_values_supported: dpopSigningAlgorithms }
      : {}),
    ...(typeof requirePushedAuthorizationRequests === "boolean"
      ? {
          require_pushed_authorization_requests:
            requirePushedAuthorizationRequests,
        }
      : {}),
    ...(typeof clientMetadataDocumentSupported === "boolean"
      ? {
          client_id_metadata_document_supported:
            clientMetadataDocumentSupported,
        }
      : {}),
  };
}

function resolveCacheTtlMs(
  headers: Headers,
  fallbackTtlMs: number
): number | null {
  const cacheControl = headers.get("cache-control");
  if (!cacheControl) {
    return fallbackTtlMs;
  }

  const directives = cacheControl
    .split(",")
    .map((directive) => directive.trim().toLowerCase());

  if (directives.includes("no-store")) {
    return null;
  }

  const maxAgeDirective = directives.find((directive) =>
    directive.startsWith("max-age=")
  );
  if (!maxAgeDirective) {
    return fallbackTtlMs;
  }

  const maxAgeSeconds = Number(maxAgeDirective.slice("max-age=".length));
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0) {
    return fallbackTtlMs;
  }

  return maxAgeSeconds * 1000;
}

export interface DiscoveryResolver {
  clear(): void;
  peek(): FirstPartyAuthDiscoveryDocument | undefined;
  read(): Promise<FirstPartyAuthDiscoveryDocument>;
}

export function createDiscoveryResolver(
  options: CreateDiscoveryResolverOptions
): DiscoveryResolver {
  let cached: CachedDiscoveryDocument | undefined;

  return {
    clear() {
      cached = undefined;
    },
    peek() {
      if (!cached || Date.now() >= cached.expiresAt) {
        return undefined;
      }

      return cached.document;
    },
    async read() {
      if (cached && Date.now() < cached.expiresAt) {
        return cached.document;
      }

      const response = await (options.fetch ?? fetch)(
        resolveDiscoveryUrl(options.issuerUrl)
      );
      if (!response.ok) {
        throw new Error(
          `Discovery failed: ${response.status} ${response.statusText}`
        );
      }

      const document = parseDiscoveryDocument(await response.json());
      const ttlMs = resolveCacheTtlMs(
        response.headers,
        options.discoveryTtlMs ?? DEFAULT_DISCOVERY_TTL_MS
      );

      cached =
        ttlMs && ttlMs > 0
          ? {
              document,
              expiresAt: Date.now() + ttlMs,
            }
          : undefined;

      return document;
    },
  };
}
