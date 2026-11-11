import "server-only";

import type { JWTPayload } from "jose";
import type { VerifiedAccessToken } from "./resource-access-token";

import { getDpopJktFromPayload } from "@better-auth/core/oauth2";
import { APIError, isAPIError } from "better-auth/api";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth/auth-config";
import { canonicalizeRequestOrigin } from "@/lib/auth/origin";

import { resolveSubForClientId } from "./pairwise";
import {
  type ResourceError,
  withResourceChallenge,
} from "./resource-challenge";

/**
 * Resolves who is calling a Zentity protected resource, through the
 * server-only endpoints of `resourceAccessTokenPlugin`, and answers a refused
 * caller with the RFC 6750, RFC 9449, or RFC 9728 challenge it can act on.
 */

export type ResourceRequestResult =
  | ({ ok: true } & VerifiedAccessToken)
  | { error: ResourceError; ok: false };

/** Refuses the access token the request presented. */
export function invalidAccessToken(
  request: Request,
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

export function resourceErrorResponse(error: ResourceError): NextResponse {
  return NextResponse.json(error.body ?? { error: error.message }, {
    status: error.statusCode,
    headers: error.headers,
  });
}

/**
 * Verifies the access token on a request to a Zentity protected resource.
 * The DPoP `htu` is the request URL on Zentity's canonical origin, the URL
 * clients derive from discovery.
 */
export async function verifyResourceRequest(
  request: Request
): Promise<ResourceRequestResult> {
  try {
    const verified = await auth.api.verifyResourceRequest({
      body: {
        authorization: request.headers.get("authorization") ?? undefined,
        dpop: request.headers.get("dpop") ?? undefined,
        method: request.method,
        url: canonicalizeRequestOrigin(request).url,
      },
    });
    return { ok: true, ...(verified as VerifiedAccessToken) };
  } catch (error) {
    // The provider throws better-call's APIError, not better-auth's subclass.
    if (isAPIError(error)) {
      return { ok: false, error: withResourceChallenge(error, request) };
    }
    throw error;
  }
}

/**
 * Introspects a token the caller presents (not the caller's own credential).
 * The payload is `{ active: false }` for an unknown, expired, or revoked token.
 */
export async function introspectZentityAccessToken(
  token: string
): Promise<VerifiedAccessToken> {
  return (await auth.api.introspectZentityAccessToken({
    body: { token },
  })) as VerifiedAccessToken;
}

interface ProtectedResourcePrincipal {
  clientId: string;
  dpopJkt: string;
  scopes: string[];
  sub: string;
  userId: string;
}

export function tokenScopes(payload: JWTPayload): string[] {
  return typeof payload.scope === "string"
    ? payload.scope.split(" ").filter(Boolean)
    : [];
}

type ProtectedResourcePrincipalResult =
  | { ok: true; principal: ProtectedResourcePrincipal }
  | { error: ResourceError; ok: false };

/**
 * The user behind a DPoP-bound opaque access token, with the subject its
 * client knows them by. Zentity-hosted endpoints receive opaque tokens only
 * (ADR privacy/0015), so a JWT audienced elsewhere is refused.
 */
export async function resolveProtectedResourcePrincipal(
  request: Request
): Promise<ProtectedResourcePrincipalResult> {
  const verified = await verifyResourceRequest(request);
  if (!verified.ok) {
    return verified;
  }
  if (verified.format !== "opaque") {
    return {
      ok: false,
      error: invalidAccessToken(
        request,
        "access token is not valid for this resource"
      ),
    };
  }
  const { payload } = verified;
  const dpopJkt = getDpopJktFromPayload(payload);
  const userId = typeof payload.sub === "string" ? payload.sub : undefined;
  const clientId =
    typeof payload.client_id === "string" ? payload.client_id : undefined;
  if (!dpopJkt) {
    return {
      ok: false,
      error: invalidAccessToken(request, "access token must be DPoP-bound"),
    };
  }
  const sub =
    userId && clientId ? await resolveSubForClientId(userId, clientId) : null;
  if (!(userId && clientId && sub)) {
    return {
      ok: false,
      error: invalidAccessToken(request, "invalid access token"),
    };
  }

  return {
    ok: true,
    principal: {
      sub,
      userId,
      clientId,
      scopes: tokenScopes(payload),
      dpopJkt,
    },
  };
}
