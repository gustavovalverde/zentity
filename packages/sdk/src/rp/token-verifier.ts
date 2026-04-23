import {
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyOptions,
  type JWTVerifyResult,
  jwtVerify,
} from "jose";
import type { AccessTokenClaims } from "../protocol/claims";

const DEFAULT_DISCOVERY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_JWKS_TTL_MS = 5 * 60 * 1000;

type RemoteJwkSet = ReturnType<typeof createRemoteJWKSet>;

export interface TokenVerifier {
  verify<T extends JWTPayload = JWTPayload>(
    token: string,
    options?: JWTVerifyOptions
  ): Promise<JWTVerifyResult<T>>;
}

export interface JwksTokenVerifierOptions {
  issuer?: string;
  jwksTtlMs?: number;
  jwksUrl: string | URL;
}

export interface OpenIdTokenVerifierOptions {
  discoveryTtlMs?: number;
  discoveryUrl?: string | URL;
  issuerUrl: string | URL;
}

export interface VerifyAccessTokenOptions extends OpenIdTokenVerifierOptions {
  audience: string | string[];
}

interface OpenIdMetadata {
  issuer: string;
  jwks_uri: string;
}

function toUrl(value: string | URL): URL {
  return value instanceof URL ? value : new URL(value);
}

function resolveOpenIdDiscoveryUrl(options: OpenIdTokenVerifierOptions): URL {
  if (options.discoveryUrl) {
    return toUrl(options.discoveryUrl);
  }

  return new URL("/.well-known/openid-configuration", toUrl(options.issuerUrl));
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

export function createJwksTokenVerifier(
  options: JwksTokenVerifierOptions
): TokenVerifier {
  let cached:
    | {
        expiresAt: number;
        value: RemoteJwkSet;
      }
    | undefined;

  function getJwks() {
    if (!cached || Date.now() >= cached.expiresAt) {
      cached = {
        expiresAt: Date.now() + (options.jwksTtlMs ?? DEFAULT_JWKS_TTL_MS),
        value: createRemoteJWKSet(toUrl(options.jwksUrl)),
      };
    }

    return cached.value;
  }

  return {
    async verify<T extends JWTPayload = JWTPayload>(
      token: string,
      verifyOptions: JWTVerifyOptions = {}
    ): Promise<JWTVerifyResult<T>> {
      return jwtVerify<T>(
        token,
        getJwks(),
        options.issuer
          ? { ...verifyOptions, issuer: options.issuer }
          : verifyOptions
      );
    },
  };
}

export function createOpenIdTokenVerifier(
  options: OpenIdTokenVerifierOptions
): TokenVerifier {
  let cached:
    | {
        expiresAt: number;
        issuer: string;
        jwks: RemoteJwkSet;
      }
    | undefined;

  async function getMetadata() {
    if (cached && Date.now() < cached.expiresAt) {
      return cached;
    }

    const response = await fetch(resolveOpenIdDiscoveryUrl(options));
    if (!response.ok) {
      throw new Error(
        `OpenID discovery request failed with HTTP ${response.status}`
      );
    }

    const metadata = (await response.json()) as Partial<OpenIdMetadata>;
    if (
      typeof metadata.issuer !== "string" ||
      typeof metadata.jwks_uri !== "string"
    ) {
      throw new Error("OpenID discovery response missing issuer or jwks_uri");
    }

    const ttlMs = resolveCacheTtlMs(
      response.headers,
      options.discoveryTtlMs ?? DEFAULT_DISCOVERY_TTL_MS
    );
    const value = {
      expiresAt: Date.now() + (ttlMs ?? 0),
      issuer: metadata.issuer,
      jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)),
    };

    cached = ttlMs && ttlMs > 0 ? value : undefined;
    return value;
  }

  return {
    async verify<T extends JWTPayload = JWTPayload>(
      token: string,
      verifyOptions: JWTVerifyOptions = {}
    ): Promise<JWTVerifyResult<T>> {
      const metadata = await getMetadata();
      return jwtVerify<T>(token, metadata.jwks, {
        ...verifyOptions,
        issuer: metadata.issuer,
      });
    },
  };
}

export async function verifyAccessToken<
  T extends JWTPayload & AccessTokenClaims = JWTPayload & AccessTokenClaims,
>(
  token: string,
  options: VerifyAccessTokenOptions
): Promise<JWTVerifyResult<T>> {
  return createOpenIdTokenVerifier(options).verify<T>(token, {
    audience: options.audience,
  });
}
