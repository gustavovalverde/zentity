import {
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyOptions,
  type JWTVerifyResult,
  jwtVerify,
} from "jose";
import type { AccessTokenClaims } from "../protocol/claims";
import { createDiscoveryResolver } from "../protocol/discovery";

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

function toUrl(value: string | URL): URL {
  return value instanceof URL ? value : new URL(value);
}

export function createJwksTokenVerifier(
  options: JwksTokenVerifierOptions
): TokenVerifier {
  const jwks = createRemoteJWKSet(toUrl(options.jwksUrl), {
    cacheMaxAge: options.jwksTtlMs ?? DEFAULT_JWKS_TTL_MS,
  });

  return {
    async verify<T extends JWTPayload = JWTPayload>(
      token: string,
      verifyOptions: JWTVerifyOptions = {}
    ): Promise<JWTVerifyResult<T>> {
      return jwtVerify<T>(
        token,
        jwks,
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
  const resolver = createDiscoveryResolver({
    issuerUrl: options.issuerUrl,
    ...(options.discoveryUrl ? { discoveryUrl: options.discoveryUrl } : {}),
    ...(typeof options.discoveryTtlMs === "number"
      ? { discoveryTtlMs: options.discoveryTtlMs }
      : {}),
  });
  // One key set per jwks_uri, so a refreshed discovery document that keeps
  // the same jwks_uri keeps jose's key cache.
  let cachedJwks: { jwksUri: string; value: RemoteJwkSet } | undefined;

  async function getVerificationContext() {
    const document = await resolver.read();
    if (!document.jwks_uri) {
      throw new Error("OpenID discovery response missing jwks_uri");
    }

    if (cachedJwks?.jwksUri !== document.jwks_uri) {
      cachedJwks = {
        jwksUri: document.jwks_uri,
        value: createRemoteJWKSet(new URL(document.jwks_uri)),
      };
    }

    return { issuer: document.issuer, jwks: cachedJwks.value };
  }

  return {
    async verify<T extends JWTPayload = JWTPayload>(
      token: string,
      verifyOptions: JWTVerifyOptions = {}
    ): Promise<JWTVerifyResult<T>> {
      const context = await getVerificationContext();
      return jwtVerify<T>(token, context.jwks, {
        ...verifyOptions,
        issuer: context.issuer,
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
