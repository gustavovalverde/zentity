import "server-only";

import {
  createInsufficientScopeError,
  parseAccessTokenAuthorization,
} from "@better-auth/core/oauth2";
import { HAIP_DPOP_SIGNING_ALGORITHMS } from "@better-auth/haip";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";

import { env } from "@/env";

/**
 * Builds the `WWW-Authenticate` challenge for a refused access token, so the
 * client learns what to do next: discover the resource metadata (RFC 9728),
 * fix its token (RFC 6750 §3.1), fix its DPoP proof (RFC 9449 §7.1), or
 * request more scopes.
 */

/** better-call's APIError, which the provider and core throw. */
export type ResourceError = ReturnType<typeof createInsufficientScopeError>;

const CHALLENGE_OPTIONS = {
  dpopSigningAlgorithms: HAIP_DPOP_SIGNING_ALGORITHMS,
};

/** Whether the request presented an access token in a supported scheme. */
function presentsToken(request: Request): boolean {
  const authorization = parseAccessTokenAuthorization(
    request.headers.get("authorization")
  );
  return Boolean(authorization?.token) && authorization?.scheme !== "Unknown";
}

/**
 * The 401 challenge for a refused token, in the scheme the request presented
 * it with. RFC 6750 §3.1 gives an error code only to a request that presented
 * a token, so a request without one gets the RFC 9728 pointer alone, even when
 * the error body names `invalid_token`.
 */
function unauthorizedChallenge(
  error: ResourceError,
  request: Request
): ResourceError {
  const input = presentsToken(request)
    ? error
    : new APIError("UNAUTHORIZED", { message: error.message }, error.headers);
  const challenge = createResourceServerChallenge(
    input,
    env.NEXT_PUBLIC_APP_URL,
    { ...CHALLENGE_OPTIONS, request }
  );
  return challenge
    ? new APIError("UNAUTHORIZED", error.body, challenge.headers)
    : error;
}

/**
 * Adds the challenge for a refused resource request and keeps the OAuth error
 * body. Errors that are not token or scope failures pass through unchanged.
 */
export function withResourceChallenge(
  error: ResourceError,
  request: Request
): ResourceError {
  if (error.status === "UNAUTHORIZED") {
    return unauthorizedChallenge(error, request);
  }
  const challenge = createResourceServerChallenge(
    error,
    env.NEXT_PUBLIC_APP_URL,
    CHALLENGE_OPTIONS
  );
  return challenge
    ? new APIError(challenge.status, error.body, challenge.headers)
    : error;
}

/** A 403 naming the scopes the client should request (RFC 6750 §3.1). */
export function insufficientScope(
  requiredScopes: string[],
  description?: string
): ResourceError {
  const error = createInsufficientScopeError(requiredScopes, description);
  const challenge = createResourceServerChallenge(
    error,
    env.NEXT_PUBLIC_APP_URL,
    CHALLENGE_OPTIONS
  );
  return challenge
    ? new APIError(challenge.status, error.body, challenge.headers)
    : error;
}

/**
 * Adds the token challenge to a UserInfo 401 that carries none. The provider
 * challenges its own refusals, but Zentity's UserInfo hooks (revoked token,
 * consumed identity release) refuse before it runs, and RFC 7235 §3.1 requires
 * a challenge on every 401.
 */
export async function withUserInfoChallenge(
  request: Request,
  response: Response
): Promise<Response> {
  if (
    response.status !== 401 ||
    response.headers.has("WWW-Authenticate") ||
    !new URL(request.url).pathname.endsWith("/oauth2/userinfo")
  ) {
    return response;
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.clone().json();
    if (parsed && typeof parsed === "object") {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Not a JSON error body; the challenge carries the generic description.
  }
  const challenged = unauthorizedChallenge(
    new APIError("UNAUTHORIZED", body),
    request
  );
  const headers = new Headers(response.headers);
  const value = new Headers(challenged.headers).get("WWW-Authenticate");
  if (value) {
    headers.set("WWW-Authenticate", value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
