import "server-only";

import { createInsufficientScopeError } from "@better-auth/core/oauth2";
import { HAIP_DPOP_SIGNING_ALGORITHMS } from "@better-auth/haip";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";

import { env } from "@/env";

/**
 * Builds the `WWW-Authenticate` challenge for a refused access token, so the
 * client learns what to do next: discover the resource metadata (RFC 9728),
 * fix its token (RFC 6750 §3.1), fix its DPoP proof (RFC 9449 §7.1), or
 * request more scopes. A 401 names its error only when the error body names
 * `invalid_token` or a DPoP error, so a request without a token gets the
 * RFC 9728 pointer alone.
 */

/** better-call's APIError, which the provider and core throw. */
export type ResourceError = ReturnType<typeof createInsufficientScopeError>;

const CHALLENGE_OPTIONS = {
  dpopSigningAlgorithms: HAIP_DPOP_SIGNING_ALGORITHMS,
};

/**
 * Adds the challenge for a refused resource request and keeps the OAuth error
 * body. A refused token is challenged in the scheme the request presented it
 * with. Errors that are not token or scope failures pass through unchanged.
 */
export function withResourceChallenge(
  error: ResourceError,
  request?: Request
): ResourceError {
  const challenge = createResourceServerChallenge(
    error,
    env.NEXT_PUBLIC_APP_URL,
    request ? { ...CHALLENGE_OPTIONS, request } : CHALLENGE_OPTIONS
  );
  return challenge
    ? new APIError(challenge.status, error.body, challenge.headers)
    : error;
}

/**
 * Refuses the access token the request presented. Without the request, as on
 * a programmatic call, the challenge uses the Bearer scheme.
 */
export function invalidAccessToken(
  request: Request | undefined,
  description: string
): ResourceError {
  return withResourceChallenge(
    new APIError("UNAUTHORIZED", {
      error: "invalid_token",
      error_description: description,
    }),
    request
  );
}

/** Points a caller that sent no access token at the resource metadata. */
export function missingAccessToken(): ResourceError {
  return withResourceChallenge(
    new APIError("UNAUTHORIZED", { message: "access token required" })
  );
}

/** A 403 naming the scopes the client should request (RFC 6750 §3.1). */
export function insufficientScope(
  requiredScopes: string[],
  description?: string
): ResourceError {
  return withResourceChallenge(
    createInsufficientScopeError(requiredScopes, description)
  );
}
