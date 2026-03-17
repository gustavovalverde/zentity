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

  // Extract sub from id_token for CIBA login_hint
  let loginHint: string | undefined;
  if (data.id_token) {
    try {
      const claims = decodeJwt(data.id_token);
      loginHint = claims.sub;
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
