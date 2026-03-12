import { config } from "../config.js";
import { updateCredentials } from "./credentials.js";
import type { DpopKeyPair } from "./dpop.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";
import { ensureReady, finishLogin, startLogin } from "./opaque-client.js";
import type { PkceChallenge } from "./pkce.js";

const MAX_RETRIES = 3;

interface ChallengeResponse {
  auth_session: string;
  challenge_type: string;
  error: string;
  server_public_key?: string;
}

interface OpaqueStartResponse {
  opaque_login_response: string;
}

interface OpaqueFinishResponse {
  authorization_code: string;
}

export interface FpaResult {
  authorizationCode: string;
  authSession: string;
  exportKey: string;
}

async function postChallenge(
  endpoint: string,
  body: Record<string, string | undefined>,
  dpopKey: DpopKeyPair,
  dpopNonce?: string
): Promise<{ dpopNonce?: string; response: Response }> {
  let proof = await createDpopProof(
    dpopKey,
    "POST",
    endpoint,
    undefined,
    dpopNonce
  );

  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      DPoP: proof,
    },
    body: JSON.stringify(body),
  });

  // DPoP nonce retry
  const newNonce = extractDpopNonce(response);
  if (
    newNonce &&
    dpopNonce !== newNonce &&
    (response.status === 400 || response.status === 401)
  ) {
    proof = await createDpopProof(
      dpopKey,
      "POST",
      endpoint,
      undefined,
      newNonce
    );
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        DPoP: proof,
      },
      body: JSON.stringify(body),
    });
    return { dpopNonce: extractDpopNonce(response) ?? newNonce, response };
  }

  return { dpopNonce: newNonce ?? dpopNonce, response };
}

/**
 * Execute the FPA Authorization Challenge flow with OPAQUE.
 *
 * Round 1: Identify user → get auth_session + challenge_type
 * Round 2: OPAQUE startLogin → get server login response
 * Round 3: OPAQUE finishLogin → get authorization_code
 */
export async function runFpaFlow(
  challengeEndpoint: string,
  clientId: string,
  pkce: PkceChallenge,
  dpopKey: DpopKeyPair,
  email: string,
  password: string,
  resource?: string
): Promise<FpaResult> {
  await ensureReady();

  let dpopNonce: string | undefined;

  // Round 1: Identify user
  const round1Body: Record<string, string | undefined> = {
    client_id: clientId,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
    identifier: email,
    resource,
    response_type: "code",
    scope: "openid email",
  };

  const round1 = await postChallenge(
    challengeEndpoint,
    round1Body,
    dpopKey,
    dpopNonce
  );
  dpopNonce = round1.dpopNonce;

  if (round1.response.status !== 401) {
    const text = await round1.response.text();
    throw new Error(
      `Expected 401 from challenge endpoint: ${round1.response.status} ${text}`
    );
  }

  const challenge = (await round1.response.json()) as ChallengeResponse;
  if (challenge.challenge_type === "redirect_to_web") {
    throw new RedirectToWebError(challenge.auth_session);
  }
  if (challenge.challenge_type !== "opaque") {
    throw new Error(`Unsupported challenge type: ${challenge.challenge_type}`);
  }

  const authSession = challenge.auth_session;

  // Round 2: OPAQUE startLogin
  const { clientLoginState, startLoginRequest } = startLogin(password);

  const round2 = await postChallenge(
    challengeEndpoint,
    {
      auth_session: authSession,
      opaque_login_request: startLoginRequest,
    },
    dpopKey,
    dpopNonce
  );
  dpopNonce = round2.dpopNonce;

  if (!round2.response.ok) {
    const text = await round2.response.text();
    throw new Error(`OPAQUE round 2 failed: ${round2.response.status} ${text}`);
  }

  const round2Data = (await round2.response.json()) as OpaqueStartResponse;

  // Round 3: OPAQUE finishLogin
  const finishResult = finishLogin(
    clientLoginState,
    round2Data.opaque_login_response,
    password
  );

  if (!finishResult) {
    throw new Error(
      "OPAQUE finishLogin failed — invalid password or server response"
    );
  }

  const round3 = await postChallenge(
    challengeEndpoint,
    {
      auth_session: authSession,
      opaque_finish_request: finishResult.finishLoginRequest,
    },
    dpopKey,
    dpopNonce
  );

  if (!round3.response.ok) {
    const text = await round3.response.text();
    throw new Error(`OPAQUE round 3 failed: ${round3.response.status} ${text}`);
  }

  const round3Data = (await round3.response.json()) as OpaqueFinishResponse;

  // Persist auth_session for step-up re-auth
  updateCredentials(config.zentityUrl, { authSession });

  return {
    authorizationCode: round3Data.authorization_code,
    authSession,
    exportKey: finishResult.exportKey,
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
      if (error instanceof RedirectToWebError) {
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

export class RedirectToWebError extends Error {
  readonly authSession: string;

  constructor(authSession: string) {
    super("Passkey-only user — redirect to browser required");
    this.name = "RedirectToWebError";
    this.authSession = authSession;
  }
}
