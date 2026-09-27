import "server-only";

import { verifyAccessToken } from "@/lib/auth/jwt";

import {
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "./haip/opaque-access-token";
import { resolveSubForClientId } from "./pairwise";

const AUTH_HEADER_RE = /^(DPoP|Bearer)\s+(.+)$/i;

interface ProtectedResourcePrincipal {
  clientId: string;
  dpopJkt: string;
  scopes: string[];
  sub: string;
  userId: string;
}

async function resolveJwtPrincipal(
  token: string,
  request: Request,
  scheme: string
): Promise<ProtectedResourcePrincipal | null> {
  if (scheme.toLowerCase() !== "dpop") {
    return null;
  }

  const payload = await verifyAccessToken(token);
  if (!payload?.sub) {
    return null;
  }

  const clientId =
    (payload.client_id as string | undefined) ??
    (payload.azp as string | undefined);
  if (!clientId) {
    return null;
  }

  const cnf = payload.cnf as { jkt?: string } | undefined;
  if (!cnf?.jkt) {
    return null;
  }

  const valid = await validateOpaqueAccessTokenDpop(request, cnf.jkt);
  if (!valid) {
    return null;
  }

  const sub = await resolveSubForClientId(payload.sub, clientId);
  if (!sub) {
    return null;
  }

  return {
    sub,
    userId: payload.sub,
    clientId,
    scopes:
      typeof payload.scope === "string"
        ? payload.scope.split(" ").filter(Boolean)
        : [],
    dpopJkt: cnf.jkt,
  };
}

async function resolveOpaquePrincipal(
  token: string,
  request: Request,
  scheme: string
): Promise<ProtectedResourcePrincipal | null> {
  if (scheme.toLowerCase() !== "dpop") {
    return null;
  }

  const row = await loadOpaqueAccessToken(token);
  if (!(row?.userId && row.clientId && row.dpopJkt)) {
    return null;
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return null;
  }

  const valid = await validateOpaqueAccessTokenDpop(request, row.dpopJkt);
  if (!valid) {
    return null;
  }

  const sub = await resolveSubForClientId(row.userId, row.clientId);
  if (!sub) {
    return null;
  }

  return {
    sub,
    userId: row.userId,
    clientId: row.clientId,
    scopes: row.scopes,
    dpopJkt: row.dpopJkt,
  };
}

export async function resolveProtectedResourcePrincipal(
  request: Request
): Promise<ProtectedResourcePrincipal | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(AUTH_HEADER_RE);
  if (!(match?.[1] && match[2])) {
    return null;
  }

  const scheme = match[1];
  const token = match[2];

  if (token.startsWith("eyJ")) {
    return await resolveJwtPrincipal(token, request, scheme);
  }

  return await resolveOpaquePrincipal(token, request, scheme);
}
