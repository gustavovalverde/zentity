import type { Session } from "./auth-config";

import { getDpopJktFromPayload } from "@better-auth/core/oauth2";
import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";

import { AGENT_BOOTSTRAP_TOKEN_USE } from "@/lib/agents/session";
import { loadOpaqueAccessTokenExtensions } from "@/lib/auth/oidc/haip/opaque-access-token";
import {
  tokenScopes,
  verifyResourceRequest,
} from "@/lib/auth/oidc/resource-principal";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";

const RP_API_AUDIENCE = `${getAuthIssuer()}/resource/rp-api`;

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

function authError(
  status: number,
  error: string,
  headers?: HeadersInit
): AuthFailure {
  return {
    ok: false,
    response: NextResponse.json({ error }, { status, headers }),
  };
}

function hasRequiredScopes(
  scopes: string[],
  requiredScopes: string[]
): requiredScopes is [] {
  return requiredScopes.every((scope) => scopes.includes(scope));
}

function audienceIncludes(aud: unknown, audience: string): boolean {
  return Array.isArray(aud) ? aud.includes(audience) : aud === audience;
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

/**
 * Requires a DPoP-bound bootstrap token: an opaque token that token exchange
 * minted for agent registration, marked by its stored `zentity_token_use`.
 */
export async function requireBootstrapAccessToken(
  request: Request,
  requiredScopes: string[] = []
): Promise<UserTokenSuccess | AuthFailure> {
  const verified = await verifyResourceRequest(request);
  if (
    !verified.ok ||
    verified.format !== "opaque" ||
    !getDpopJktFromPayload(verified.payload)
  ) {
    return authError(401, "Bootstrap access token required");
  }
  const { payload, token } = verified;
  const extensions = await loadOpaqueAccessTokenExtensions(token);
  const userId = typeof payload.sub === "string" ? payload.sub : undefined;
  const clientId =
    typeof payload.client_id === "string" ? payload.client_id : undefined;
  if (
    !(userId && clientId) ||
    extensions?.exchangeClaims.zentity_token_use !== AGENT_BOOTSTRAP_TOKEN_USE
  ) {
    return authError(401, "Bootstrap access token required");
  }

  const scopes = tokenScopes(payload);
  if (!hasRequiredScopes(scopes, requiredScopes)) {
    return authError(403, "Missing required scope");
  }

  return {
    ok: true,
    principal: { kind: "user_access_token", userId, clientId, scopes, token },
  };
}

/**
 * Requires a client_credentials JWT access token for the RP API: its subject
 * is the client itself and its audience the RP API resource.
 */
export async function requireClientCredentials(
  request: Request,
  requiredScopes: string[] = []
): Promise<ClientCredentialsSuccess | AuthFailure> {
  const verified = await verifyResourceRequest(request);
  if (!verified.ok) {
    const body = verified.error.body as
      | { error_description?: string }
      | undefined;
    return authError(
      verified.error.statusCode,
      body?.error_description ?? "Invalid access token",
      verified.error.headers
    );
  }
  const { payload, token } = verified;
  if (verified.format !== "jwt") {
    return authError(401, "Opaque client credentials tokens are not supported");
  }
  if (!audienceIncludes(payload.aud, RP_API_AUDIENCE)) {
    return authError(401, "Invalid access token");
  }

  const clientId =
    typeof payload.client_id === "string" ? payload.client_id : undefined;
  if (!clientId) {
    return authError(401, "Missing client_id");
  }
  // A client_credentials token's subject is the client itself; a distinct
  // subject means a user token.
  if (payload.sub && payload.sub !== clientId) {
    return authError(401, "Not a client credentials token");
  }

  const scopes = tokenScopes(payload);
  if (!hasRequiredScopes(scopes, requiredScopes)) {
    return authError(401, "Missing required scope");
  }

  return {
    ok: true,
    principal: { kind: "client_credentials", clientId, scopes, token },
  };
}
