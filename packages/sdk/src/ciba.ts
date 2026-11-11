import type { DpopClient } from "./rp/dpop-client";

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
  dpopClient: Pick<DpopClient, "fetch">;
  fetch?: typeof globalThis.fetch;
  loginHint: string;
  onPendingApproval?:
    | ((pending: CibaPendingApproval) => Promise<void> | void)
    | undefined;
  resource?: string | undefined;
  scope: string;
  tokenEndpoint: string;
}

export interface CibaTokenSet {
  accessToken: string;
  authorizationDetails?: unknown[];
  expiresAt: number;
  idToken?: string;
}

export type CibaPollResult =
  | { status: "approved"; tokenSet: CibaTokenSet }
  | { message: string; status: "denied" }
  | {
      pendingAuthorization: CibaPendingAuthorization;
      status: "pending";
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
    super("Authorization request expired - user did not respond in time");
    this.name = "CibaTimeoutError";
  }
}

export async function requestCibaApproval(
  params: CibaRequest
): Promise<CibaTokenSet> {
  const pendingAuthorization = await beginCibaApproval(params);
  await params.onPendingApproval?.(
    createPendingApproval(params, pendingAuthorization)
  );

  return pollCibaToken(params, pendingAuthorization);
}

export async function beginCibaApproval(
  params: CibaRequest
): Promise<CibaPendingAuthorization> {
  const body = buildCibaBody(params);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (params.agentAssertion) {
    headers["Agent-Assertion"] = params.agentAssertion;
  }

  const response = await params.dpopClient.fetch(params.cibaEndpoint, {
    method: "POST",
    headers,
    body,
    ...(params.fetch ? { fetch: params.fetch } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CIBA authorization failed: ${response.status} ${text}`);
  }

  const authResponse = (await response.json()) as CibaAuthResponse;

  return {
    authReqId: authResponse.auth_req_id,
    expiresIn: authResponse.expires_in,
    intervalSeconds: authResponse.interval ?? DEFAULT_POLL_INTERVAL_MS / 1000,
  };
}

type CibaPollParams = Pick<
  CibaRequest,
  "clientId" | "dpopClient" | "fetch" | "tokenEndpoint"
>;

export async function pollCibaToken(
  params: CibaPollParams,
  pendingAuthorization: CibaPendingAuthorization
): Promise<CibaTokenSet> {
  const deadline = Date.now() + pendingAuthorization.expiresIn * 1000;
  let interval = pendingAuthorization.intervalSeconds * 1000;
  let retryImmediately = false;

  while (Date.now() < deadline) {
    if (!retryImmediately) {
      await sleep(interval);
    }

    const response = await requestCibaToken(params, pendingAuthorization);
    const pollOutcome = await parsePollResponse(response, interval);
    if (pollOutcome.done) {
      return pollOutcome.tokenSet;
    }
    interval = pollOutcome.nextInterval;
    // A stale nonce is retried at once, but only once in a row, so a
    // server that keeps rejecting nonces cannot turn polling into a loop.
    retryImmediately = pollOutcome.nonceRejected && !retryImmediately;
  }

  throw new CibaTimeoutError();
}

function requestCibaToken(
  params: CibaPollParams,
  pendingAuthorization: CibaPendingAuthorization
): Promise<Response> {
  return params.dpopClient.fetch(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:openid:params:grant-type:ciba",
      auth_req_id: pendingAuthorization.authReqId,
      client_id: params.clientId,
    }),
    ...(params.fetch ? { fetch: params.fetch } : {}),
  });
}

export async function pollCibaTokenOnce(
  params: CibaPollParams,
  pendingAuthorization: CibaPendingAuthorization
): Promise<CibaPollResult> {
  const response = await requestCibaToken(params, pendingAuthorization);

  try {
    const pollOutcome = await parsePollResponse(
      response,
      pendingAuthorization.intervalSeconds * 1000
    );

    if (pollOutcome.done) {
      return { status: "approved", tokenSet: pollOutcome.tokenSet };
    }

    return {
      status: "pending",
      pendingAuthorization: {
        ...pendingAuthorization,
        intervalSeconds: pollOutcome.nextInterval / 1000,
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

export function logPendingApprovalHandoff(
  pending: CibaPendingApproval
): void {
  console.error(`[ciba] Approval required: ${pending.approvalUrl}`);
  console.error(
    `[ciba] Expires in ${pending.expiresIn}s; polling every ${pending.intervalSeconds}s`
  );
}

export function createPendingApproval(
  params: Pick<CibaRequest, "cibaEndpoint">,
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
  params: Pick<CibaRequest, "cibaEndpoint">
): string {
  return new URL(params.cibaEndpoint).origin;
}

type PollOutcome =
  | { done: true; tokenSet: CibaTokenSet }
  | { done: false; nextInterval: number; nonceRejected: boolean };

async function parsePollResponse(
  response: Response,
  currentInterval: number
): Promise<PollOutcome> {
  if (response.ok) {
    const tokenResponse = (await response.json()) as CibaTokenResponse;
    return {
      done: true,
      tokenSet: {
        accessToken: tokenResponse.access_token,
        expiresAt: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
        ...(tokenResponse.authorization_details
          ? { authorizationDetails: tokenResponse.authorization_details }
          : {}),
        ...(tokenResponse.id_token ? { idToken: tokenResponse.id_token } : {}),
      },
    };
  }

  const error = (await response.json()) as CibaErrorResponse;

  if (error.error === "authorization_pending") {
    return { done: false, nextInterval: currentInterval, nonceRejected: false };
  }
  if (error.error === "use_dpop_nonce") {
    return { done: false, nextInterval: currentInterval, nonceRejected: true };
  }
  if (error.error === "slow_down") {
    return {
      done: false,
      nextInterval: currentInterval + SLOW_DOWN_INCREMENT_MS,
      nonceRejected: false,
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
