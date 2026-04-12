import "server-only";

import { createDpopAccessTokenValidator } from "@better-auth/haip";
import { decodeJwt } from "jose";

import {
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "./opaque-access-token";

const validateDpop = createDpopAccessTokenValidator({ requireDpop: false });

/**
 * Rewrite `Authorization: DPoP <token>` to `Authorization: Bearer <token>`
 * after validating the DPoP proof. This bridges the gap between RFC 9449
 * DPoP clients and better-auth's userinfo endpoint which only parses Bearer.
 *
 * - Bearer requests pass through unchanged.
 * - DPoP requests: decode the JWT, validate the proof (enforces cnf.jkt
 *   binding when present), then rewrite to Bearer for the downstream handler.
 */
export async function rewriteDpopForUserinfo(
  request: Request
): Promise<Request> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("DPoP ")) {
    return request;
  }

  const token = authorization.slice(5);

  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = decodeJwt(token) as Record<string, unknown>;
  } catch {
    const opaqueToken = await loadOpaqueAccessToken(token);
    if (opaqueToken?.dpopJkt) {
      const validDpop = await validateOpaqueAccessTokenDpop(
        request,
        opaqueToken.dpopJkt
      );
      if (!validDpop) {
        throw new Error("Invalid DPoP proof");
      }
    }
    return rewriteBearer(request, token);
  }

  await validateDpop({ request, tokenPayload });

  return rewriteBearer(request, token);
}

function rewriteBearer(request: Request, token: string): Request {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  return new Request(request.url, { method: request.method, headers });
}
