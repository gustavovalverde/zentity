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
    loginHint,
    refreshToken: data.refresh_token,
  });

  return {
    accessToken: data.access_token,
    expiresAt,
    idToken: data.id_token,
    loginHint,
    refreshToken: data.refresh_token,
  };
}
