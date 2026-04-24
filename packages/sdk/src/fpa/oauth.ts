import { decodeJwt } from "jose";
import type { DpopClient } from "../rp/dpop-client";
import { fetchUserInfo } from "../rp/userinfo";

export interface ExchangeAuthorizationCodeOptions {
  clientId: string;
  code: string;
  codeVerifier: string;
  dpopClient: DpopClient;
  redirectUri: string;
  resource?: string;
  tokenEndpoint: string;
}

export interface ExchangeTokenOptions {
  audience: string;
  clientId: string;
  dpopClient: DpopClient;
  scope?: string;
  subjectToken: string;
  tokenEndpoint: string;
}

export interface TokenResult {
  accessToken: string;
  accountSub?: string;
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
  loginHint?: string;
  scope?: string;
  tokenType: string;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

const APP_LOGIN_HINT_CLAIM = "zentity_login_hint";

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
  body: URLSearchParams
): Promise<TokenResponse> {
  const { response } = await dpopClient.withNonceRetry(async (nonce) => {
    const proof = await dpopClient.proofFor(
      "POST",
      tokenEndpoint,
      undefined,
      nonce
    );
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: proof,
      },
      body,
    });
    return { response, result: null };
  });

  if (!response.ok) {
    throw new Error(
      `Token exchange failed: ${response.status} ${await response.text()}`
    );
  }

  return (await response.json()) as TokenResponse;
}

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
      decodeJwtClaim(accessToken, "sub") ||
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

  const accountSub =
    decodeJwtClaim(accessToken, "sub") || decodeJwtClaim(idToken, "sub");

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
    redirect_uri: options.redirectUri,
  });
  if (options.resource) {
    body.set("resource", options.resource);
  }

  const data = await requestToken(options.dpopClient, options.tokenEndpoint, body);
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
    client_id: options.clientId,
    audience: options.audience,
    subject_token: options.subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });
  if (options.scope) {
    body.set("scope", options.scope);
  }

  const data = await requestToken(options.dpopClient, options.tokenEndpoint, body);
  const accountSub = decodeJwtClaim(data.access_token, "sub");
  const loginHint = decodeJwtClaim(data.access_token, APP_LOGIN_HINT_CLAIM);

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in ?? 3600,
    ...(data.scope ? { scope: data.scope } : {}),
    ...(accountSub ? { accountSub } : {}),
    ...(loginHint ? { loginHint } : {}),
  };
}
