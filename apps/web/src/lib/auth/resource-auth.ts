import { createDpopAccessTokenValidator } from "@better-auth/haip";
import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/env";
import { AGENT_BOOTSTRAP_TOKEN_USE } from "@/lib/agents/session";
import { verifyAccessToken, verifyAuthIssuedJwt } from "@/lib/auth/jwt";
import {
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "@/lib/auth/oidc/haip/opaque-access-token";
import {
  extractAccessToken,
  type OAuthTokenValidationResult,
  validateOAuthAccessToken,
} from "@/lib/auth/oidc/oauth-request";
import { resolveUserIdFromSub } from "@/lib/auth/oidc/pairwise";

import { auth, type Session } from "./auth-config";

const AUTH_HEADER_RE = /^(DPoP|Bearer)\s+(.+)$/i;
const dpopValidator = createDpopAccessTokenValidator({ requireDpop: false });
const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");

interface UserAccessPrincipal {
  clientId: string;
  kind: "user_access_token";
  scopes: string[];
  token: string;
  userId: string;
}

interface ClientCredentialsPrincipal {
  clientId: string;
  kind: "client_credentials";
  scopes: string[];
  token: string;
}

interface AuthFailure {
  ok: false;
  response: NextResponse<{ error: string }>;
}

interface BrowserSessionSuccess {
  ok: true;
  session: Session;
}

interface UserTokenSuccess {
  ok: true;
  principal: UserAccessPrincipal;
}

interface ClientCredentialsSuccess {
  ok: true;
  principal: ClientCredentialsPrincipal;
}

function authError(status: number, error: string): AuthFailure {
  return {
    ok: false,
    response: NextResponse.json({ error }, { status }),
  };
}

function hasRequiredScopes(
  scopes: string[],
  requiredScopes: string[]
): requiredScopes is [] {
  return requiredScopes.every((scope) => scopes.includes(scope));
}

function audienceIncludes(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") {
    return audience === expected;
  }

  return Array.isArray(audience) && audience.includes(expected);
}

function getClientIdFromPayload(
  payload: Record<string, unknown>
): string | undefined {
  return (
    (payload.client_id as string | undefined) ??
    (payload.azp as string | undefined)
  );
}

async function resolveOpaqueUserAccessToken(
  request: Request,
  token: string,
  scheme: string
): Promise<UserAccessPrincipal | null> {
  const accessToken = await loadOpaqueAccessToken(token);
  if (!accessToken?.userId || accessToken.expiresAt < new Date()) {
    return null;
  }

  if (accessToken.dpopJkt) {
    if (scheme.toLowerCase() !== "dpop") {
      return null;
    }
    const validDpop = await validateOpaqueAccessTokenDpop(
      request,
      accessToken.dpopJkt
    );
    if (!validDpop) {
      return null;
    }
  }

  return {
    kind: "user_access_token",
    userId: accessToken.userId,
    clientId: accessToken.clientId,
    scopes: accessToken.scopes,
    token,
  };
}

async function resolveJwtUserAccessToken(
  request: Request,
  token: string,
  scheme: string,
  options?: { requiredTokenUse?: string }
): Promise<UserAccessPrincipal | null> {
  const payload =
    options?.requiredTokenUse === undefined
      ? await verifyAccessToken(token)
      : await verifyAuthIssuedJwt(token);
  if (!payload?.sub) {
    return null;
  }

  if (options?.requiredTokenUse) {
    if (payload.zentity_token_use !== options.requiredTokenUse) {
      return null;
    }
    if (!audienceIncludes(payload.aud, appUrl)) {
      return null;
    }
  }

  const cnf = payload.cnf as { jkt?: string } | undefined;
  if (cnf?.jkt) {
    if (scheme.toLowerCase() !== "dpop") {
      return null;
    }
    try {
      await dpopValidator({
        request,
        tokenPayload: payload as Record<string, unknown>,
      });
    } catch {
      return null;
    }
  } else if (options?.requiredTokenUse) {
    return null;
  }

  const clientId = getClientIdFromPayload(payload as Record<string, unknown>);
  if (!clientId) {
    return null;
  }

  const userId = await resolveUserIdFromSub(payload.sub, clientId);
  if (!userId) {
    return null;
  }

  return {
    kind: "user_access_token",
    userId,
    clientId,
    scopes:
      typeof payload.scope === "string"
        ? payload.scope.split(" ").filter(Boolean)
        : [],
    token,
  };
}

function resolveUserAccessPrincipal(
  request: Request,
  options?: { requiredTokenUse?: string }
): Promise<UserAccessPrincipal | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Promise.resolve(null);
  }

  const match = authHeader.match(AUTH_HEADER_RE);
  if (!(match?.[1] && match[2])) {
    return Promise.resolve(null);
  }

  const scheme = match[1];
  const token = match[2];

  if (token.startsWith("eyJ")) {
    return resolveJwtUserAccessToken(request, token, scheme, options);
  }

  if (options?.requiredTokenUse) {
    return Promise.resolve(null);
  }

  return resolveOpaqueUserAccessToken(request, token, scheme);
}

function asClientCredentialsPrincipal(
  token: string,
  validation: OAuthTokenValidationResult
): ClientCredentialsPrincipal | null {
  if (!(validation.valid && validation.clientId)) {
    return null;
  }

  return {
    kind: "client_credentials",
    clientId: validation.clientId,
    scopes: validation.scopes ?? [],
    token,
  };
}

export async function requireBrowserSession(
  requestHeaders?: Headers
): Promise<BrowserSessionSuccess | AuthFailure> {
  const hdrs = requestHeaders ?? (await nextHeaders());
  const session = await auth.api.getSession({
    headers: hdrs,
  });

  if (!session?.user?.id) {
    return authError(401, "Authentication required");
  }

  return { ok: true, session };
}

export async function requireBootstrapAccessToken(
  request: Request,
  requiredScopes: string[] = []
): Promise<UserTokenSuccess | AuthFailure> {
  const principal = await resolveUserAccessPrincipal(request, {
    requiredTokenUse: AGENT_BOOTSTRAP_TOKEN_USE,
  });
  if (!principal) {
    return authError(401, "Bootstrap access token required");
  }

  if (!hasRequiredScopes(principal.scopes, requiredScopes)) {
    return authError(403, "Missing required scope");
  }

  return { ok: true, principal };
}

export async function requireClientCredentials(
  request: Request,
  requiredScopes: string[] = []
): Promise<ClientCredentialsSuccess | AuthFailure> {
  const authHeader = request.headers.get("authorization");
  const match = authHeader?.match(AUTH_HEADER_RE);
  const token = extractAccessToken(request.headers);
  if (!token) {
    return authError(401, "Client credentials token required");
  }

  const validation = await validateOAuthAccessToken(token, {
    requiredScopes,
  });
  const principal = asClientCredentialsPrincipal(token, validation);
  if (!principal) {
    return authError(401, validation.error ?? "Invalid access token");
  }

  if (token.startsWith("eyJ")) {
    const payload = await verifyAuthIssuedJwt(token);
    const cnf = payload?.cnf as { jkt?: string } | undefined;
    if (cnf?.jkt) {
      if (match?.[1]?.toLowerCase() !== "dpop") {
        return authError(401, "DPoP proof required");
      }
      try {
        await dpopValidator({
          request,
          tokenPayload: payload as Record<string, unknown>,
        });
      } catch {
        return authError(401, "Invalid DPoP proof");
      }
    }
  }

  return { ok: true, principal };
}
