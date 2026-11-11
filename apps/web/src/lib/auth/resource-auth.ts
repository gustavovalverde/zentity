import type { ResourceError } from "@/lib/auth/oidc/resource-challenge";
import type { Session } from "./auth-config";

import { getDpopJktFromPayload } from "@better-auth/core/oauth2";
import { headers as nextHeaders } from "next/headers";
import { NextResponse } from "next/server";

import { AGENT_BOOTSTRAP_TOKEN_USE } from "@/lib/agents/session";
import { resolveAuthenticationContext } from "@/lib/auth/auth-context";
import { loadOpaqueAccessTokenExtensions } from "@/lib/auth/oidc/haip/opaque-access-token";
import { insufficientScope } from "@/lib/auth/oidc/resource-challenge";
import {
  invalidAccessToken,
  resourceErrorResponse,
  tokenScopes,
  verifyResourceRequest,
} from "@/lib/auth/oidc/resource-principal";
import { getAuthIssuer } from "@/lib/auth/oidc/well-known";

const RP_API_AUDIENCE = `${getAuthIssuer()}/resource/rp-api`;

interface UserAccessPrincipal {
  /** The user's authentication the token was issued from, when recorded. */
  authContextId: string | null;
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
  response: NextResponse;
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

function resourceAuthError(error: ResourceError): AuthFailure {
  return { ok: false, response: resourceErrorResponse(error) };
}

function missingScopes(scopes: string[], requiredScopes: string[]): string[] {
  return requiredScopes.filter((scope) => !scopes.includes(scope));
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
  if (!verified.ok) {
    return resourceAuthError(verified.error);
  }
  if (
    verified.format !== "opaque" ||
    !getDpopJktFromPayload(verified.payload)
  ) {
    return resourceAuthError(
      invalidAccessToken(request, "bootstrap access token required")
    );
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
    return resourceAuthError(
      invalidAccessToken(request, "bootstrap access token required")
    );
  }

  const scopes = tokenScopes(payload);
  const missing = missingScopes(scopes, requiredScopes);
  if (missing.length > 0) {
    return resourceAuthError(insufficientScope(missing));
  }

  const authentication = await resolveAuthenticationContext({
    authContextId: extensions.authContextId,
    sessionId: typeof payload.sid === "string" ? payload.sid : null,
  });

  return {
    ok: true,
    principal: {
      kind: "user_access_token",
      authContextId: authentication?.id ?? null,
      userId,
      clientId,
      scopes,
      token,
    },
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
    return resourceAuthError(verified.error);
  }
  const { payload, token } = verified;
  if (verified.format !== "jwt") {
    return resourceAuthError(
      invalidAccessToken(
        request,
        "opaque client credentials tokens are not supported"
      )
    );
  }
  if (!audienceIncludes(payload.aud, RP_API_AUDIENCE)) {
    return resourceAuthError(
      invalidAccessToken(request, "invalid access token")
    );
  }

  const clientId =
    typeof payload.client_id === "string" ? payload.client_id : undefined;
  if (!clientId) {
    return resourceAuthError(invalidAccessToken(request, "missing client_id"));
  }
  // A client_credentials token's subject is the client itself; a distinct
  // subject means a user token.
  if (payload.sub && payload.sub !== clientId) {
    return resourceAuthError(
      invalidAccessToken(request, "not a client credentials token")
    );
  }

  const scopes = tokenScopes(payload);
  const missing = missingScopes(scopes, requiredScopes);
  if (missing.length > 0) {
    return resourceAuthError(insufficientScope(missing));
  }

  return {
    ok: true,
    principal: { kind: "client_credentials", clientId, scopes, token },
  };
}
