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

// RFC 6750 §3 limits error_description to printable ASCII without `"` or `\`,
// and the challenge builder throws on anything else. Core DPoP messages can
// quote values (`typ must be "dpop+jwt"`).
const AUTH_PARAM_UNSAFE = /[^\x20-\x21\x23-\x5b\x5d-\x7e]/g;
const ERROR_CODE = /^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/;

const CHALLENGE_OPTIONS = {
  dpopSigningAlgorithms: HAIP_DPOP_SIGNING_ALGORITHMS,
};

function challengeDescription(error: ResourceError): string {
  const body = error.body as { error_description?: unknown } | undefined;
  const description =
    typeof body?.error_description === "string"
      ? body.error_description
      : error.message;
  return (
    description.replaceAll('"', "'").replace(AUTH_PARAM_UNSAFE, "") ||
    "invalid access token"
  );
}

function challengeErrorCode(error: ResourceError): string {
  const code = (error.body as { error?: unknown } | undefined)?.error;
  return typeof code === "string" && ERROR_CODE.test(code)
    ? code
    : "invalid_token";
}

/** The scheme the request presented its access token with, if any. */
function presentedScheme(request: Request): "Bearer" | "DPoP" | null {
  const authorization = parseAccessTokenAuthorization(
    request.headers.get("authorization")
  );
  if (!authorization?.token || authorization.scheme === "Unknown") {
    return null;
  }
  return authorization.scheme;
}

/**
 * The 401 challenge for a refused token. Better Auth's
 * `createResourceServerChallenge` builds the DPoP challenge for a failed proof
 * and the RFC 9728 pointer otherwise, but leaves out the error code for a
 * presented token. RFC 6750 §3.1 and RFC 9449 §7.1 ask for it, in the scheme
 * the client used, so it is added here. A request that presented no token
 * gets the pointer alone.
 */
function unauthorizedChallenge(
  error: ResourceError,
  request: Request
): ResourceError {
  const description = challengeDescription(error);
  const input = new APIError(
    "UNAUTHORIZED",
    { ...error.body, error_description: description },
    error.headers
  );
  const challenge = createResourceServerChallenge(
    input,
    env.NEXT_PUBLIC_APP_URL,
    CHALLENGE_OPTIONS
  );
  if (!challenge) {
    return input;
  }
  const headers = new Headers(challenge.headers);
  const value = headers.get("WWW-Authenticate") ?? "";
  const scheme = presentedScheme(request);
  if (scheme && value.startsWith("Bearer ")) {
    const code = challengeErrorCode(error);
    headers.set(
      "WWW-Authenticate",
      scheme === "DPoP"
        ? `DPoP error="${code}", error_description="${description}", algs="${HAIP_DPOP_SIGNING_ALGORITHMS.join(" ")}"`
        : `Bearer error="${code}", error_description="${description}", ${value.slice("Bearer ".length)}`
    );
  }
  return new APIError("UNAUTHORIZED", input.body, headers);
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
 * sends one only for an unknown token and for `use_dpop_nonce`; a missing
 * token, other DPoP binding failures, and Zentity's own UserInfo hooks
 * (revoked token, consumed identity release) reach the client without one,
 * which RFC 7235 §3.1 does not allow.
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
