import { RedirectToWebError as FirstPartyRedirectToWebError } from "@zentity/sdk/fpa";
import { config } from "../config.js";
import type { DpopKeyPair } from "./dpop.js";
import { ensureFirstPartyAuth } from "./first-party-auth.js";
import { INSTALLED_AGENT_LOGIN_SCOPE_STRING } from "./installed-agent-scopes.js";
import type { PkceChallenge } from "./pkce.js";

const RedirectToWebError = FirstPartyRedirectToWebError;

export { RedirectToWebError };

const MAX_RETRIES = 3;

export interface FpaResult {
  authorizationCode: string;
  authSession: string;
  exportKey: string;
}

/**
 * Execute the FPA Authorization Challenge flow with OPAQUE.
 *
 * Round 1: Identify user → get auth_session + challenge_type
 * Round 2: OPAQUE startLogin → get server login response
 * Round 3: OPAQUE finishLogin → get authorization_code
 */
export async function runFpaFlow(
  _challengeEndpoint: string,
  clientId: string,
  pkce: PkceChallenge,
  _dpopKey: DpopKeyPair,
  email: string,
  password: string,
  resource?: string
): Promise<FpaResult> {
  const result = await ensureFirstPartyAuth(config.zentityUrl).authorize({
    clientId,
    identifier: email,
    pkce,
    ...(resource ? { resource } : {}),
    scope: INSTALLED_AGENT_LOGIN_SCOPE_STRING,
    strategies: {
      password: {
        password,
      },
    },
  });

  if (!result.exportKey) {
    throw new Error("OPAQUE authorization response missing exportKey");
  }

  return {
    authorizationCode: result.authorizationCode,
    authSession: result.authSession,
    exportKey: result.exportKey,
  };
}

/**
 * Run the full FPA flow with retries on invalid credentials.
 */
export async function runFpaFlowWithRetries(
  challengeEndpoint: string,
  clientId: string,
  pkce: PkceChallenge,
  dpopKey: DpopKeyPair,
  getCredentials: () => Promise<{ email: string; password: string }>,
  resource?: string
): Promise<FpaResult> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { email, password } = await getCredentials();
    try {
      return await runFpaFlow(
        challengeEndpoint,
        clientId,
        pkce,
        dpopKey,
        email,
        password,
        resource
      );
    } catch (error) {
      if (error instanceof FirstPartyRedirectToWebError) {
        throw error;
      }
      if (attempt < MAX_RETRIES) {
        console.error(
          `Authentication failed (attempt ${attempt}/${MAX_RETRIES}). Try again.`
        );
      } else {
        throw error;
      }
    }
  }
  throw new Error("Authentication failed after maximum retries");
}
