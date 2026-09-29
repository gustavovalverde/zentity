import type { Session } from "./auth-config";

import { createDpopAccessTokenValidator } from "@better-auth/haip";
import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";

import { AGENT_BOOTSTRAP_TOKEN_USE } from "@/lib/agents/session";
import {
  loadOpaqueAccessToken,
  validateOpaqueAccessTokenDpop,
} from "@/lib/auth/oidc/haip/opaque-access-token";
import {
  extractAccessToken,
  type OAuthTokenValidationResult,
  validateOAuthAccessToken,
} from "@/lib/auth/oidc/oauth-request";

const AUTH_HEADER_RE = /^(DPoP|Bearer)\s+(.+)$/i;
const dpopValidator = createDpopAccessTokenValidator({ requireDpop: false });

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

async function resolveBootstrapPrincipal(
  request: Request
): Promise<UserAccessPrincipal | null> {
  const match = request.headers.get("authorization")?.match(AUTH_HEADER_RE);
  const scheme = match?.[1];
  const token = match?.[2];
  if (!(scheme && token) || scheme.toLowerCase() !== "dpop") {
    return null;
  }

  const accessToken = await loadOpaqueAccessToken(token);
  if (
    !(accessToken?.userId && accessToken.dpopJkt) ||
    accessToken.expiresAt < new Date() ||
    accessToken.exchangeClaims.zentity_token_use !== AGENT_BOOTSTRAP_TOKEN_USE
  ) {
    return null;
  }

  if (!(await validateOpaqueAccessTokenDpop(request, accessToken.dpopJkt))) {
    return null;
  }

  return {
    kind: "user_access_token",
    userId: accessToken.userId,
    clientId: accessToken.clientId,
    scopes: accessToken.scopes,
    token,
  };
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
  // Lazy import breaks the import cycle: auth-config → disclosure → resource-auth → auth-config.
  const { auth } = await import("./auth-config");
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
  const principal = await resolveBootstrapPrincipal(request);
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

  const payload = validation.payload;
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

  return { ok: true, principal };
}
