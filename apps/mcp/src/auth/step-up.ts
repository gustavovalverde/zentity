import { config } from "../config.js";
import { loadCredentials } from "./credentials.js";
import type { DpopKeyPair } from "./dpop.js";
import { RedirectToWebError, runFpaFlow } from "./fpa.js";
import { generatePkce } from "./pkce.js";
import { exchangeAuthCode } from "./token-exchange.js";

interface StepUpErrorBody {
  acr_values?: string;
  auth_session?: string;
  error: string;
  error_description?: string;
}

export class StepUpRequiredError extends Error {
  readonly acrValues: string | undefined;
  readonly authSession: string;

  constructor(authSession: string, acrValues?: string) {
    super("Step-up re-authentication required");
    this.name = "StepUpRequiredError";
    this.authSession = authSession;
    this.acrValues = acrValues;
  }
}

/**
 * Parse an error response from the token endpoint and throw
 * StepUpRequiredError if it indicates insufficient authorization.
 */
export function detectStepUp(status: number, responseBody: string): void {
  if (status !== 403) {
    return;
  }

  try {
    const body = JSON.parse(responseBody) as StepUpErrorBody;
    if (body.error === "insufficient_authorization" && body.auth_session) {
      throw new StepUpRequiredError(body.auth_session, body.acr_values);
    }
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      throw error;
    }
    // Not a step-up response — ignore parse errors
  }
}

export interface StepUpParams {
  challengeEndpoint: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  getPassword: () => Promise<string>;
  redirectUri: string;
  resource?: string;
  tokenEndpoint: string;
}

/**
 * Perform step-up re-authentication via FPA.
 *
 * Uses the stored email and prompts for password only.
 * Re-enters the FPA OPAQUE flow to get a fresh auth code,
 * then exchanges it for new tokens.
 */
export async function performStepUp(
  stepUpError: StepUpRequiredError,
  params: StepUpParams
): Promise<string> {
  const creds = loadCredentials(config.zentityUrl);
  if (!creds?.loginHint) {
    throw new Error("Cannot step up — no stored user identity");
  }

  console.error(
    `[step-up] Re-authentication required${stepUpError.acrValues ? ` (acr: ${stepUpError.acrValues})` : ""}`
  );

  const password = await params.getPassword();
  const pkce = await generatePkce();

  try {
    const fpaResult = await runFpaFlow(
      params.challengeEndpoint,
      params.clientId,
      pkce,
      params.dpopKey,
      creds.loginHint,
      password,
      params.resource
    );

    const tokenResult = await exchangeAuthCode(
      params.tokenEndpoint,
      fpaResult.authorizationCode,
      pkce.codeVerifier,
      params.clientId,
      params.redirectUri,
      params.dpopKey,
      params.resource
    );

    return tokenResult.accessToken;
  } catch (error) {
    if (error instanceof RedirectToWebError) {
      throw new Error(
        "Step-up requires passkey — browser redirect not supported in step-up flow"
      );
    }
    throw error;
  }
}
