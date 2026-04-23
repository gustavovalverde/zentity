import {
  detectStepUp as detectFirstPartyStepUp,
  RedirectToWebError as FirstPartyRedirectToWebError,
  StepUpRequiredError as FirstPartyStepUpRequiredError,
} from "@zentity/sdk/fpa";
import { config } from "../config.js";
import { loadCredentials } from "./credentials.js";
import type { DpopKeyPair } from "./dpop.js";
import { ensureFirstPartyAuth } from "./first-party-auth.js";

const StepUpRequiredError = FirstPartyStepUpRequiredError;
const detectStepUp = detectFirstPartyStepUp;

export { detectStepUp, StepUpRequiredError };

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
 * Complete step-up re-authentication via FPA.
 *
 * Uses the stored email and prompts for password only.
 * Re-enters the FPA OPAQUE flow to get a fresh auth code,
 * then exchanges it for new tokens.
 */
export async function completeStepUp(
  stepUpError: FirstPartyStepUpRequiredError,
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

  try {
    const tokenResult = await ensureFirstPartyAuth(config.zentityUrl).stepUp({
      authSession: stepUpError.authSession,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      ...(params.resource ? { resource: params.resource } : {}),
      strategies: {
        password: {
          password,
        },
      },
    });

    return tokenResult.accessToken;
  } catch (error) {
    if (error instanceof FirstPartyRedirectToWebError) {
      throw new Error(
        "Step-up requires passkey — browser redirect not supported in step-up flow"
      );
    }
    throw error;
  }
}
