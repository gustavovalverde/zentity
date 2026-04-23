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

export interface DpopProofSigner {
  proofFor(
    method: string,
    url: string | URL,
    accessToken?: string,
    nonce?: string
  ): Promise<string>;
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
  dpopSigner: DpopProofSigner;
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

  let dpopNonce: string | undefined;
  let dpopProof = await params.dpopSigner.proofFor(
    "POST",
    params.cibaEndpoint,
    undefined,
    dpopNonce
  );

  const fetchFn = params.fetch ?? fetch;

  let response = await fetchFn(params.cibaEndpoint, {
    method: "POST",
    headers: { ...headers, DPoP: dpopProof },
    body,
  });

  const nonce = extractDpopNonce(response);
  if (
    nonce &&
    dpopNonce !== nonce &&
    (response.status === 400 || response.status === 401)
  ) {
    dpopNonce = nonce;
    dpopProof = await params.dpopSigner.proofFor(
      "POST",
      params.cibaEndpoint,
      undefined,
      dpopNonce
    );
    response = await fetchFn(params.cibaEndpoint, {
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
  params: Pick<CibaRequest, "clientId" | "dpopSigner" | "fetch" | "tokenEndpoint">,
  pendingAuthorization: CibaPendingAuthorization
): Promise<CibaTokenSet> {
  return pollForTokenDpop(
    params.tokenEndpoint,
    pendingAuthorization.authReqId,
    params.clientId,
    params.dpopSigner,
    params.fetch,
    pendingAuthorization.dpopNonce,
    pendingAuthorization.intervalSeconds * 1000,
    pendingAuthorization.expiresIn * 1000
  );
}

export async function pollCibaTokenOnce(
  params: Pick<CibaRequest, "clientId" | "dpopSigner" | "fetch" | "tokenEndpoint">,
  pendingAuthorization: CibaPendingAuthorization
): Promise<CibaPollResult> {
  const dpopProof = await params.dpopSigner.proofFor(
    "POST",
    params.tokenEndpoint,
    undefined,
    pendingAuthorization.dpopNonce
  );

  const response = await (params.fetch ?? fetch)(params.tokenEndpoint, {
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
        dpopNonce: nextNonce,
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

async function pollForTokenDpop(
  tokenEndpoint: string,
  authReqId: string,
  clientId: string,
  dpopSigner: DpopProofSigner,
  fetchFn: typeof globalThis.fetch | undefined,
  dpopNonce: string | undefined,
  intervalMs: number,
  timeoutMs: number
): Promise<CibaTokenSet> {
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

    const dpopProof = await dpopSigner.proofFor(
      "POST",
      tokenEndpoint,
      undefined,
      currentNonce
    );

    const response = await (fetchFn ?? fetch)(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        DPoP: dpopProof,
      },
      body,
    });

    currentNonce = extractDpopNonce(response) ?? currentNonce;

    const pollOutcome = await parsePollResponse(response, currentInterval);
    if (pollOutcome.done) {
      return pollOutcome.tokenSet;
    }
    currentInterval = pollOutcome.nextInterval;
  }

  throw new CibaTimeoutError();
}

type PollOutcome =
  | { done: true; tokenSet: CibaTokenSet }
  | { done: false; nextInterval: number };

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

function extractDpopNonce(response: Response): string | undefined {
  return response.headers.get("dpop-nonce") ?? undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
