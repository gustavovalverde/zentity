import { decodeJwt } from "jose";
import { config } from "../config.js";
import { updateCredentials } from "./credentials.js";
import type { DpopKeyPair } from "./dpop.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

export interface TokenResult {
  accessToken: string;
  expiresAt: number;
  idToken?: string;
  loginHint?: string;
  refreshToken?: string;
}

export interface ExchangeTokenResult {
  accessToken: string;
  expiresIn: number;
  scope?: string;
  tokenType: string;
}

export interface ExchangeTokenParams {
  audience: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  scope?: string;
  subjectToken: string;
  tokenEndpoint: string;
}

async function fetchUserInfo(
  accessToken: string,
  dpopKey: DpopKeyPair
): Promise<Record<string, unknown> | null> {
  const userinfoUrl = new URL(
    "/api/auth/oauth2/userinfo",
    config.zentityUrl
  ).toString();

  let dpopNonce: string | undefined;
  let dpopProof = await createDpopProof(
    dpopKey,
    "GET",
    userinfoUrl,
    accessToken,
    dpopNonce
  );

  let response = await fetch(userinfoUrl, {
    headers: {
      Authorization: `DPoP ${accessToken}`,
      DPoP: dpopProof,
    },
  });

  const newNonce = extractDpopNonce(response);
  if (
    newNonce &&
    dpopNonce !== newNonce &&
    (response.status === 400 || response.status === 401)
  ) {
    dpopNonce = newNonce;
    dpopProof = await createDpopProof(
      dpopKey,
      "GET",
      userinfoUrl,
      accessToken,
      dpopNonce
    );
    response = await fetch(userinfoUrl, {
      headers: {
        Authorization: `DPoP ${accessToken}`,
        DPoP: dpopProof,
      },
    });
  }

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (
    data &&
    typeof data === "object" &&
    "response" in data &&
    data.response &&
    typeof data.response === "object"
  ) {
    return data.response as Record<string, unknown>;
  }

  return data;
}

export async function resolveLoginHint(
  accessToken: string,
  dpopKey: DpopKeyPair
): Promise<string | undefined> {
  const userinfo = await fetchUserInfo(accessToken, dpopKey);
  if (!userinfo) {
    return undefined;
  }

  if (typeof userinfo.email === "string" && userinfo.email) {
    return userinfo.email;
  }
  if (
    typeof userinfo.preferred_username === "string" &&
    userinfo.preferred_username
  ) {
    return userinfo.preferred_username;
  }
  if (typeof userinfo.sub === "string" && userinfo.sub) {
    return userinfo.sub;
  }
  if (typeof userinfo.id === "string" && userinfo.id) {
    return userinfo.id;
  }
  return undefined;
}

export async function exchangeAuthCode(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
  dpopKey: DpopKeyPair,
  resource?: string
): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });
  if (resource) {
    body.set("resource", resource);
  }

  let dpopNonce: string | undefined;

  // First attempt — may get a nonce-required response
  let dpopProof = await createDpopProof(
    dpopKey,
    "POST",
    tokenEndpoint,
    undefined,
    dpopNonce
  );

  let response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: dpopProof,
    },
    body,
  });

  // DPoP nonce retry dance
  if (response.status === 400 || response.status === 401) {
    const newNonce = extractDpopNonce(response);
    if (newNonce) {
      dpopNonce = newNonce;
      dpopProof = await createDpopProof(
        dpopKey,
        "POST",
        tokenEndpoint,
        undefined,
        dpopNonce
      );

      response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: dpopProof,
        },
        body,
      });
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as TokenResponse;

  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;

  let loginHint = await resolveLoginHint(data.access_token, dpopKey);
  if (!loginHint && data.id_token) {
    try {
      const claims = decodeJwt(data.id_token);
      if (typeof claims.sub === "string") {
        loginHint = claims.sub;
      }
    } catch {
      // id_token decode is best-effort
    }
  }

  updateCredentials(config.zentityUrl, {
    accessToken: data.access_token,
    expiresAt,
    ...(loginHint ? { loginHint } : {}),
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
  });

  return {
    accessToken: data.access_token,
    expiresAt,
    ...(data.id_token ? { idToken: data.id_token } : {}),
    ...(loginHint ? { loginHint } : {}),
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
  };
}

/**
 * RFC 8693 token exchange — exchange an access token for a scoped,
 * audience-bound token (e.g., merchant-specific from a CIBA token).
 */
export async function exchangeToken(
  params: ExchangeTokenParams
): Promise<ExchangeTokenResult> {
  const { tokenEndpoint, dpopKey } = params;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: params.subjectToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    audience: params.audience,
    client_id: params.clientId,
  });
  if (params.scope) {
    body.set("scope", params.scope);
  }

  let dpopNonce: string | undefined;

  let dpopProof = await createDpopProof(
    dpopKey,
    "POST",
    tokenEndpoint,
    undefined,
    dpopNonce
  );

  let response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: dpopProof,
    },
    body,
  });

  // DPoP nonce retry dance
  if (response.status === 400 || response.status === 401) {
    const newNonce = extractDpopNonce(response);
    if (newNonce) {
      dpopNonce = newNonce;
      dpopProof = await createDpopProof(
        dpopKey,
        "POST",
        tokenEndpoint,
        undefined,
        dpopNonce
      );

      response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          DPoP: dpopProof,
        },
        body,
      });
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as TokenResponse;

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
    ...(data.scope ? { scope: data.scope } : {}),
    tokenType: data.token_type,
  };
}
