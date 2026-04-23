import {
  exchangeToken as exchangeFirstPartyToken,
  type ExchangeTokenResult as FirstPartyExchangeTokenResult,
  type TokenResult as FirstPartyTokenResult,
  resolveOAuthIdentity as resolveFirstPartyOAuthIdentity,
} from "@zentity/sdk/fpa";
import { createDpopClientFromKeyPair } from "@zentity/sdk/rp";
import { config } from "../config.js";
import type { DpopKeyPair } from "./dpop.js";
import { ensureFirstPartyAuth } from "./first-party-auth.js";

type ExchangeTokenResult = FirstPartyExchangeTokenResult;
type TokenResult = FirstPartyTokenResult;

export type { ExchangeTokenResult, TokenResult };

export interface ExchangeTokenParams {
  audience: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  scope?: string;
  subjectToken: string;
  tokenEndpoint: string;
}

export async function resolveOAuthIdentity(
  accessToken: string,
  dpopKey: DpopKeyPair,
  idToken?: string
): Promise<{ accountSub?: string; loginHint?: string }> {
  return resolveFirstPartyOAuthIdentity(
    config.zentityUrl,
    accessToken,
    await createDpopClientFromKeyPair(dpopKey),
    idToken
  );
}

export async function resolveLoginHint(
  accessToken: string,
  dpopKey: DpopKeyPair
): Promise<string | undefined> {
  return (await resolveOAuthIdentity(accessToken, dpopKey)).loginHint;
}

export function exchangeAuthCode(
  _tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
  _dpopKey: DpopKeyPair,
  resource?: string
): Promise<FirstPartyTokenResult> {
  return ensureFirstPartyAuth(config.zentityUrl).exchangeAuthorizationCode({
    clientId,
    code,
    codeVerifier,
    redirectUri,
    ...(resource ? { resource } : {}),
  });
}

/**
 * RFC 8693 token exchange — exchange an access token for a scoped,
 * audience-bound token (e.g., merchant-specific from a CIBA token).
 */
export async function exchangeToken(
  params: ExchangeTokenParams
): Promise<FirstPartyExchangeTokenResult> {
  return exchangeFirstPartyToken({
    audience: params.audience,
    clientId: params.clientId,
    dpopClient: await ensureFirstPartyAuth(
      config.zentityUrl
    ).getOrCreateDpopClient(),
    ...(params.scope ? { scope: params.scope } : {}),
    subjectToken: params.subjectToken,
    tokenEndpoint: (await ensureFirstPartyAuth(config.zentityUrl).discover())
      .token_endpoint,
  });
}
