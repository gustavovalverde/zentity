import { z } from "zod";
import { AGENT_SESSION_INACTIVE_DESCRIPTION } from "./agent-contract";
import {
	AAP_CLAIMS_VERSION,
	type AccessTokenDelegationClaim,
	type AccessTokenOversightClaim,
	type CapabilityClaim,
} from "./protocol/claims";
import type { DpopClient } from "./rp/dpop-client";
import { authenticateClientRequest } from "./rp/token-request";

const DEFAULT_POLL_INTERVAL_MS = 5000;
const SLOW_DOWN_INCREMENT_MS = 5000;

const cibaAuthResponseSchema = z.object({
  auth_req_id: z.string().min(1),
  expires_in: z.number().positive(),
  interval: z.number().nonnegative().optional(),
});

const oversightSchema = z.object({
  approved_at: z.number(),
  method: z.enum(["capability_grant", "session", "user_verification"]),
});

const capabilitySchema = z.object({
  action: z.string().min(1),
  constraints: z.unknown().optional(),
});

const delegationSchema = z.object({
  depth: z.number(),
  max_depth: z.number(),
});

// A member this SDK does not understand must not fail the token response.
const cibaTokenResponseSchema = z.object({
  aap_claims_version: z
    .literal(AAP_CLAIMS_VERSION)
    .optional()
    .catch(undefined),
  access_token: z.string().min(1),
  authorization_details: z.array(z.unknown()).optional(),
  capabilities: z.array(capabilitySchema).optional().catch(undefined),
  delegation: delegationSchema.optional().catch(undefined),
  expires_in: z.number().optional(),
  id_token: z.string().optional(),
  oversight: oversightSchema.optional().catch(undefined),
});

const cibaErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional().catch(undefined),
});

function parseCibaResponse<T extends z.ZodType>(
  schema: T,
  body: unknown,
  name: string
): z.output<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `Invalid CIBA ${name} response: ${z.prettifyError(result.error)}`
    );
  }
  return result.data;
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
  /** For a confidential client: sent as `client_secret_basic`. */
  clientSecret?: string | undefined;
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

/** How the user approved the request, as Zentity recorded it. */
export type CibaOversight = AccessTokenOversightClaim;

/**
 * A CIBA token response. `capabilities`, `delegation`, and `aapClaimsVersion`
 * are present when a verified agent made the request; read them here rather
 * than from the access token, which a client must treat as opaque.
 */
export interface CibaTokenSet {
  aapClaimsVersion?: typeof AAP_CLAIMS_VERSION;
  accessToken: string;
  authorizationDetails?: unknown[];
  capabilities?: CapabilityClaim[];
  delegation?: AccessTokenDelegationClaim;
  expiresAt: number;
  idToken?: string;
  oversight?: CibaOversight;
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

/**
 * bc-authorize refused the request. `error` and `errorDescription` are the
 * OAuth error response members, when the body had them.
 */
export class CibaAuthorizationError extends Error {
  readonly error: string | undefined;
  readonly errorDescription: string | undefined;
  readonly status: number;

  constructor(status: number, body: string) {
    super(`CIBA authorization failed: ${status} ${body}`);
    this.name = "CibaAuthorizationError";
    this.status = status;
    let parsed: z.output<typeof cibaErrorResponseSchema> | undefined;
    try {
      parsed = cibaErrorResponseSchema.safeParse(JSON.parse(body)).data;
    } catch {
      parsed = undefined;
    }
    this.error = parsed?.error;
    this.errorDescription = parsed?.error_description;
  }
}

/**
 * Whether bc-authorize refused the Agent-Assertion because its session is no
 * longer active. The runtime then registers a new session, signs the request
 * again, and sends it once more.
 */
export function isAgentSessionInactiveError(error: unknown): boolean {
  return (
    error instanceof CibaAuthorizationError &&
    error.error === "invalid_request" &&
    error.errorDescription === AGENT_SESSION_INACTIVE_DESCRIPTION
  );
}

export async function beginCibaApproval(
  params: CibaRequest
): Promise<CibaPendingAuthorization> {
  const body = buildCibaBody(params);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  authenticateClientRequest(params, body, headers);
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
    throw new CibaAuthorizationError(response.status, text);
  }

  const authResponse = parseCibaResponse(
    cibaAuthResponseSchema,
    await response.json(),
    "authorization"
  );

  return {
    authReqId: authResponse.auth_req_id,
    expiresIn: authResponse.expires_in,
    intervalSeconds: authResponse.interval ?? DEFAULT_POLL_INTERVAL_MS / 1000,
  };
}

type CibaPollParams = Pick<
  CibaRequest,
  "clientId" | "clientSecret" | "dpopClient" | "fetch" | "tokenEndpoint"
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
  const body = new URLSearchParams({
    grant_type: "urn:openid:params:grant-type:ciba",
    auth_req_id: pendingAuthorization.authReqId,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  authenticateClientRequest(params, body, headers);
  return params.dpopClient.fetch(params.tokenEndpoint, {
    method: "POST",
    headers,
    body,
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
    const tokenResponse = parseCibaResponse(
      cibaTokenResponseSchema,
      await response.json(),
      "token"
    );
    return {
      done: true,
      tokenSet: {
        accessToken: tokenResponse.access_token,
        expiresAt: Date.now() + (tokenResponse.expires_in ?? 3600) * 1000,
        ...(tokenResponse.authorization_details
          ? { authorizationDetails: tokenResponse.authorization_details }
          : {}),
        ...(tokenResponse.id_token ? { idToken: tokenResponse.id_token } : {}),
        ...(tokenResponse.oversight
          ? { oversight: tokenResponse.oversight }
          : {}),
        ...(tokenResponse.capabilities
          ? { capabilities: tokenResponse.capabilities }
          : {}),
        ...(tokenResponse.delegation
          ? { delegation: tokenResponse.delegation }
          : {}),
        ...(tokenResponse.aap_claims_version
          ? { aapClaimsVersion: tokenResponse.aap_claims_version }
          : {}),
      },
    };
  }

  const errorResult = cibaErrorResponseSchema.safeParse(
    await response.json().catch(() => undefined)
  );
  if (!errorResult.success) {
    throw new Error(`CIBA poll error: HTTP ${response.status}`);
  }
  const error = errorResult.data;

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
