import { decodeJwt, type JWK } from "jose";
import type { DpopClient } from "../rp/dpop-client";
import {
  type ClientAuthentication,
  requestTokenEndpoint,
} from "../rp/token-request";
import { fetchUserInfo } from "../rp/userinfo";

export interface ExchangeAuthorizationCodeOptions {
  clientAssertionAudience?: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  dpopClient: DpopClient;
  privateJwk?: JWK;
  /**
   * The `redirect_uri` of the browser authorization request that issued the
   * code. Omit it for a code from the Authorization Challenge Endpoint, which
   * is bound to none.
   */
  redirectUri?: string;
  resource?: string;
  signingAlgorithm?: "ES256";
  tokenEndpoint: string;
}

export interface ExchangeTokenOptions {
  audience: string;
  clientAssertionAudience?: string;
  clientId: string;
  /** For a confidential client: sent as `client_secret_basic`. */
  clientSecret?: string;
  dpopClient: DpopClient;
  privateJwk?: JWK;
  scope?: string;
  signingAlgorithm?: "ES256";
  subjectToken: string;
  tokenEndpoint: string;
  userInfoEndpoint?: string;
}

export interface TokenResult {
  accessToken: string;
  accountSub?: string;
  /**
   * The `auth_session` for a later step-up (draft-ietf-oauth-first-party-apps
   * §6.1). It replaces the handle the challenge rounds used.
   */
  authSession?: string;
  expiresAt: number;
  idToken?: string;
  loginHint?: string;
  refreshToken?: string;
  scopes: string[];
}

export interface ExchangeTokenResult {
  accessToken: string;
  accountSub?: string;
  expiresIn: number;
  scope?: string;
  tokenType: string;
}

interface TokenResponse {
  access_token: string;
  auth_session?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

function decodeJwtClaim(
  token: string | undefined,
  claim: string
): string | undefined {
  if (!token?.startsWith("eyJ")) {
    return undefined;
  }

  try {
    const payload = decodeJwt(token);
    const value = payload[claim];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function requestToken(
  dpopClient: DpopClient,
  tokenEndpoint: string,
  body: URLSearchParams,
  client?: ClientAuthentication
): Promise<TokenResponse> {
  const { response, body: responseBody } = await requestTokenEndpoint(
    dpopClient,
    tokenEndpoint,
    body,
    client
  );

  if (!response.ok) {
    throw new Error(
      `Token exchange failed: ${response.status} ${await response.text()}`
    );
  }

  return responseBody as TokenResponse;
}

async function readUserInfoSubject(
  userInfoEndpoint: string,
  accessToken: string,
  dpopClient: DpopClient
): Promise<string | undefined> {
  const userInfo = await fetchUserInfo({
    accessToken,
    dpopClient,
    unwrapResponseEnvelope: false,
    userInfoUrl: userInfoEndpoint,
  });
  return typeof userInfo?.sub === "string" && userInfo.sub
    ? userInfo.sub
    : undefined;
}

/**
 * The account the tokens are for, from UserInfo or the ID token. The access
 * token is never read: a client must treat it as opaque (RFC 9068 §6), and
 * its `sub` names the user for its audience, not for this client.
 */
export async function resolveOAuthIdentity(
  issuerUrl: string | URL,
  accessToken: string,
  dpopClient: DpopClient,
  idToken?: string
): Promise<{ accountSub?: string; loginHint?: string }> {
  const userInfo = await fetchUserInfo({
    accessToken,
    dpopClient,
    unwrapResponseEnvelope: false,
    userInfoUrl: new URL("/api/auth/oauth2/userinfo", issuerUrl),
  });

  if (userInfo) {
    const accountSub =
      (typeof userInfo.sub === "string" && userInfo.sub) ||
      decodeJwtClaim(idToken, "sub");
    const loginHint =
      (typeof userInfo.email === "string" && userInfo.email) ||
      (typeof userInfo.preferred_username === "string" &&
        userInfo.preferred_username) ||
      accountSub ||
      (typeof userInfo.id === "string" && userInfo.id) ||
      undefined;

    return {
      ...(accountSub ? { accountSub } : {}),
      ...(loginHint ? { loginHint } : {}),
    };
  }

  const accountSub = decodeJwtClaim(idToken, "sub");

  return {
    ...(accountSub ? { accountSub, loginHint: accountSub } : {}),
  };
}

export async function exchangeAuthorizationCode(
  issuerUrl: string | URL,
  options: ExchangeAuthorizationCodeOptions
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    code_verifier: options.codeVerifier,
    client_id: options.clientId,
  });
  if (options.redirectUri) {
    body.set("redirect_uri", options.redirectUri);
  }
  if (options.resource) {
    body.set("resource", options.resource);
  }

  const data = await requestToken(
    options.dpopClient,
    options.tokenEndpoint,
    body,
    {
      clientId: options.clientId,
      ...(options.privateJwk
        ? {
            privateJwk: options.privateJwk,
            signingAlgorithm: "ES256" as const,
            ...(options.clientAssertionAudience
              ? { clientAssertionAudience: options.clientAssertionAudience }
              : {}),
          }
        : {}),
    }
  );
  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  const { accountSub, loginHint } = await resolveOAuthIdentity(
    issuerUrl,
    data.access_token,
    options.dpopClient,
    data.id_token
  );

  return {
    accessToken: data.access_token,
    ...(accountSub ? { accountSub } : {}),
    ...(typeof data.auth_session === "string" && data.auth_session
      ? { authSession: data.auth_session }
      : {}),
    expiresAt,
    ...(data.id_token ? { idToken: data.id_token } : {}),
    ...(loginHint ? { loginHint } : {}),
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    scopes:
      typeof data.scope === "string"
        ? data.scope.split(" ").filter(Boolean)
        : [],
  };
}

export async function exchangeToken(
  options: ExchangeTokenOptions
): Promise<ExchangeTokenResult> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: options.audience,
    subject_token: options.subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });
  if (options.scope) {
    body.set("scope", options.scope);
  }

  const data = await requestToken(
    options.dpopClient,
    options.tokenEndpoint,
    body,
    {
      clientId: options.clientId,
      ...(options.clientSecret === undefined
        ? {}
        : { clientSecret: options.clientSecret }),
      ...(options.privateJwk
        ? {
            privateJwk: options.privateJwk,
            signingAlgorithm: "ES256" as const,
            ...(options.clientAssertionAudience
              ? { clientAssertionAudience: options.clientAssertionAudience }
              : {}),
          }
        : {}),
    }
  );
  const accountSub = options.userInfoEndpoint
    ? await readUserInfoSubject(
        options.userInfoEndpoint,
        data.access_token,
        options.dpopClient
      )
    : undefined;

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in ?? 3600,
    ...(data.scope ? { scope: data.scope } : {}),
    ...(accountSub ? { accountSub } : {}),
  };
}
