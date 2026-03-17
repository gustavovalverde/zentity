import type { DpopKeyPair } from "./dpop.js";
import { createDpopProof, extractDpopNonce } from "./dpop.js";

const DEFAULT_POLL_INTERVAL_MS = 5000;
const SLOW_DOWN_INCREMENT_MS = 5000;

interface CibaAuthResponse {
  auth_req_id: string;
  expires_in: number;
  interval?: number;
}

interface CibaTokenResponse {
  access_token: string;
  authorization_details?: unknown[];
  expires_in?: number;
  id_token?: string;
  token_type: string;
}

interface CibaErrorResponse {
  error: string;
  error_description?: string;
}

export interface CibaRequest {
  authorizationDetails?: unknown[];
  bindingMessage: string;
  cibaEndpoint: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  loginHint: string;
  resource?: string;
  scope: string;
  tokenEndpoint: string;
}

export interface CibaResult {
  accessToken: string;
  authorizationDetails?: unknown[];
  idToken?: string;
}

export class CibaDeniedError extends Error {
  constructor(description?: string) {
    super(description ?? "User denied the authorization request");
    this.name = "CibaDeniedError";
  }
}

export class CibaTimeoutError extends Error {
  constructor() {
    super("Authorization request expired — user did not respond in time");
    this.name = "CibaTimeoutError";
  }
}

export async function requestCibaApproval(
  params: CibaRequest
): Promise<CibaResult> {
  const { cibaEndpoint, tokenEndpoint, dpopKey } = params;

  const body = buildCibaBody(params);

  let dpopNonce: string | undefined;
  let dpopProof = await createDpopProof(
    dpopKey,
    "POST",
    cibaEndpoint,
    undefined,
    dpopNonce
  );

  let response = await fetch(cibaEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: dpopProof,
    },
    body,
  });

  // DPoP nonce retry
  const nonce = extractDpopNonce(response);
  if (
    nonce &&
    dpopNonce !== nonce &&
    (response.status === 400 || response.status === 401)
  ) {
    dpopNonce = nonce;
    dpopProof = await createDpopProof(
      dpopKey,
      "POST",
      cibaEndpoint,
      undefined,
      dpopNonce
    );
    response = await fetch(cibaEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: dpopProof,
      },
      body,
    });
  }
  dpopNonce = extractDpopNonce(response) ?? dpopNonce;

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CIBA authorization failed: ${response.status} ${text}`);
  }

  const authResponse = (await response.json()) as CibaAuthResponse;

  return pollForTokenDpop(
    tokenEndpoint,
    authResponse.auth_req_id,
    params.clientId,
    dpopKey,
    dpopNonce,
    authResponse.interval != null
      ? authResponse.interval * 1000
      : DEFAULT_POLL_INTERVAL_MS,
    authResponse.expires_in * 1000
  );
}

async function pollForTokenDpop(
  tokenEndpoint: string,
  authReqId: string,
  clientId: string,
  dpopKey: DpopKeyPair,
  dpopNonce: string | undefined,
  intervalMs: number,
  timeoutMs: number
): Promise<CibaResult> {
  const deadline = Date.now() + timeoutMs;
  let currentInterval = intervalMs;
  let currentNonce = dpopNonce;

  while (Date.now() < deadline) {
    await sleep(currentInterval);

    const body = new URLSearchParams({
      grant_type: "urn:openid:params:grant-type:ciba",
      auth_req_id: authReqId,
      client_id: clientId,
    });

    const dpopProof = await createDpopProof(
      dpopKey,
      "POST",
      tokenEndpoint,
      undefined,
      currentNonce
    );

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: dpopProof,
      },
      body,
    });

    currentNonce = extractDpopNonce(response) ?? currentNonce;

    const result = await handlePollResponse(response, currentInterval);
    if (result.done) {
      return result.value;
    }
    currentInterval = result.nextInterval;
  }

  throw new CibaTimeoutError();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildCibaBody(params: CibaRequest): URLSearchParams {
  const body = new URLSearchParams({
    client_id: params.clientId,
    login_hint: params.loginHint,
    scope: params.scope,
    binding_message: params.bindingMessage,
  });
  if (params.resource) {
    body.set("resource", params.resource);
  }
  if (params.authorizationDetails) {
    body.set(
      "authorization_details",
      JSON.stringify(params.authorizationDetails)
    );
  }
  return body;
}

type PollOutcome =
  | { done: true; value: CibaResult }
  | { done: false; nextInterval: number };

async function handlePollResponse(
  response: Response,
  currentInterval: number
): Promise<PollOutcome> {
  if (response.ok) {
    const data = (await response.json()) as CibaTokenResponse;
    return {
      done: true,
      value: {
        accessToken: data.access_token,
        ...(data.authorization_details
          ? { authorizationDetails: data.authorization_details }
          : {}),
        ...(data.id_token ? { idToken: data.id_token } : {}),
      },
    };
  }

  const error = (await response.json()) as CibaErrorResponse;

  if (error.error === "authorization_pending") {
    return { done: false, nextInterval: currentInterval };
  }
  if (error.error === "slow_down") {
    return {
      done: false,
      nextInterval: currentInterval + SLOW_DOWN_INCREMENT_MS,
    };
  }
  if (error.error === "access_denied") {
    throw new CibaDeniedError(error.error_description);
  }
  if (error.error === "expired_token") {
    throw new CibaTimeoutError();
  }

  throw new Error(
    `CIBA poll error: ${error.error} ${error.error_description ?? ""}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
