import { createHash } from "node:crypto";

import { createDpopAccessTokenValidator } from "@better-auth/haip";
import { eq } from "drizzle-orm";
import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";

import {
  extractAccessToken,
  type OAuthTokenValidationResult,
  validateOAuthAccessToken,
} from "@/lib/auth/oauth-token-validation";
import { parseStoredStringArray } from "@/lib/db/adapter-compat";
import { db } from "@/lib/db/connection";
import { oauthAccessTokens } from "@/lib/db/schema/oauth-provider";
import { verifyAccessToken, verifyAuthIssuedJwt } from "@/lib/trpc/jwt-session";

import { auth, type Session } from "./auth";

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

async function resolveOpaqueUserAccessToken(
  token: string
): Promise<UserAccessPrincipal | null> {
  const tokenHash = createHash("sha256").update(token).digest("base64url");
  const accessToken = await db
    .select({
      clientId: oauthAccessTokens.clientId,
      expiresAt: oauthAccessTokens.expiresAt,
      scopes: oauthAccessTokens.scopes,
      userId: oauthAccessTokens.userId,
    })
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.token, tokenHash))
    .limit(1)
    .get();

  if (!accessToken?.userId || accessToken.expiresAt < new Date()) {
    return null;
  }

  return {
    kind: "user_access_token",
    userId: accessToken.userId,
    clientId: accessToken.clientId,
    scopes: parseStoredStringArray(accessToken.scopes),
    token,
  };
}

async function resolveJwtUserAccessToken(
  request: Request,
  token: string,
  scheme: string
): Promise<UserAccessPrincipal | null> {
  const payload = await verifyAccessToken(token);
  if (!payload?.sub) {
    return null;
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
  }

  const clientId =
    (payload.client_id as string | undefined) ??
    (payload.azp as string | undefined);
  if (!clientId) {
    return null;
  }

  return {
    kind: "user_access_token",
    userId: payload.sub,
    clientId,
    scopes:
      typeof payload.scope === "string"
        ? payload.scope.split(" ").filter(Boolean)
        : [],
    token,
  };
}

function resolveUserAccessPrincipal(
  request: Request
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
    return resolveJwtUserAccessToken(request, token, scheme);
  }

  return resolveOpaqueUserAccessToken(token);
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

export async function requireUserAccessToken(
  request: Request,
  requiredScopes: string[] = []
): Promise<UserTokenSuccess | AuthFailure> {
  const principal = await resolveUserAccessPrincipal(request);
  if (!principal) {
    return authError(401, "User access token required");
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
