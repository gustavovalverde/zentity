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

export interface CibaPendingAuthorization {
  authReqId: string;
  dpopNonce?: string | undefined;
  expiresIn: number;
  intervalSeconds: number;
}

export interface CibaPendingApproval {
  approvalUrl: string;
  authReqId: string;
  expiresIn: number;
  intervalSeconds: number;
}

export interface CibaRequest {
  agentAssertion?: string | undefined;
  authorizationDetails?: unknown[];
  bindingMessage: string;
  cibaEndpoint: string;
  clientId: string;
  dpopKey: DpopKeyPair;
  loginHint: string;
  onPendingApproval?:
    | ((pending: CibaPendingApproval) => Promise<void> | void)
    | undefined;
  resource?: string | undefined;
  scope: string;
  tokenEndpoint: string;
}

export interface CibaResult {
  accessToken: string;
  authorizationDetails?: unknown[];
  idToken?: string;
}

export type CibaPollResult =
  | { status: "approved"; result: CibaResult }
  | { status: "denied"; message: string }
  | {
      status: "pending";
      pendingAuthorization: CibaPendingAuthorization;
    }
  | { status: "timed_out" };

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
  const pendingAuthorization = await beginCibaApproval(params);
  await params.onPendingApproval?.(
    createPendingApproval(params, pendingAuthorization)
  );

  return pollCibaToken(params, pendingAuthorization);
}

export async function beginCibaApproval(
  params: CibaRequest
): Promise<CibaPendingAuthorization> {
  const { cibaEndpoint, dpopKey } = params;

  const body = buildCibaBody(params);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (params.agentAssertion) {
    headers["Agent-Assertion"] = params.agentAssertion;
  }

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
    headers: { ...headers, DPoP: dpopProof },
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
      headers: { ...headers, DPoP: dpopProof },
      body,
    });
  }
  dpopNonce = extractDpopNonce(response) ?? dpopNonce;

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CIBA authorization failed: ${response.status} ${text}`);
  }

  const authResponse = (await response.json()) as CibaAuthResponse;

  return {
    authReqId: authResponse.auth_req_id,
    dpopNonce,
    expiresIn: authResponse.expires_in,
    intervalSeconds: authResponse.interval ?? DEFAULT_POLL_INTERVAL_MS / 1000,
  };
}

export function pollCibaToken(
  params: Pick<CibaRequest, "clientId" | "dpopKey" | "tokenEndpoint">,
  pendingAuthorization: CibaPendingAuthorization
): Promise<CibaResult> {
  return pollForTokenDpop(
    params.tokenEndpoint,
    pendingAuthorization.authReqId,
    params.clientId,
    params.dpopKey,
    pendingAuthorization.dpopNonce,
    pendingAuthorization.intervalSeconds * 1000,
    pendingAuthorization.expiresIn * 1000
  );
}

export async function pollCibaTokenOnce(
  params: Pick<CibaRequest, "clientId" | "dpopKey" | "tokenEndpoint">,
  pendingAuthorization: CibaPendingAuthorization
): Promise<CibaPollResult> {
  const dpopProof = await createDpopProof(
    params.dpopKey,
    "POST",
    params.tokenEndpoint,
    undefined,
    pendingAuthorization.dpopNonce
  );

  const response = await fetch(params.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: dpopProof,
    },
    body: new URLSearchParams({
      grant_type: "urn:openid:params:grant-type:ciba",
      auth_req_id: pendingAuthorization.authReqId,
      client_id: params.clientId,
    }),
  });

  const nextNonce =
    extractDpopNonce(response) ?? pendingAuthorization.dpopNonce;

  try {
    const result = await handlePollResponse(
      response,
      pendingAuthorization.intervalSeconds * 1000
    );

    if (result.done) {
      return { status: "approved", result: result.value };
    }

    return {
      status: "pending",
      pendingAuthorization: {
        ...pendingAuthorization,
        dpopNonce: nextNonce,
        intervalSeconds: result.nextInterval / 1000,
      },
    };
  } catch (error) {
    if (error instanceof CibaDeniedError) {
      return { status: "denied", message: error.message };
    }
    if (error instanceof CibaTimeoutError) {
      return { status: "timed_out" };
    }
    throw error;
  }
}

export function logPendingApprovalHandoff(pending: CibaPendingApproval): void {
  console.error(`[ciba] Approval required: ${pending.approvalUrl}`);
  console.error(
    `[ciba] Expires in ${pending.expiresIn}s; polling every ${pending.intervalSeconds}s`
  );
}

export function createPendingApproval(
  params: Pick<CibaRequest, "cibaEndpoint" | "resource">,
  pendingAuthorization: CibaPendingAuthorization
): CibaPendingApproval {
  return {
    approvalUrl: buildCliHandoffApprovalUrl(
      resolveApprovalBaseUrl(params),
      pendingAuthorization.authReqId
    ),
    authReqId: pendingAuthorization.authReqId,
    expiresIn: pendingAuthorization.expiresIn,
    intervalSeconds: pendingAuthorization.intervalSeconds,
  };
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

function buildCliHandoffApprovalUrl(
  baseUrl: string,
  authReqId: string
): string {
  const approvalUrl = new URL(
    `/approve/${encodeURIComponent(authReqId)}`,
    baseUrl
  );
  approvalUrl.searchParams.set("source", "cli_handoff");
  return approvalUrl.toString();
}

function resolveApprovalBaseUrl(
  params: Pick<CibaRequest, "cibaEndpoint" | "resource">
): string {
  return params.resource ?? new URL(params.cibaEndpoint).origin;
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
