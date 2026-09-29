import "server-only";

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
  const match = request.headers.get("authorization")?.match(AUTH_HEADER_RE);
  if (!(match?.[1] && match[2])) {
    return null;
  }

  return await resolveOpaquePrincipal(match[2], request, match[1]);
}
