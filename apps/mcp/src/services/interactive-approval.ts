import { randomUUID } from "node:crypto";
import {
  type InputRequiredResult,
  inputRequired,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import {
  beginCibaApproval,
  type CibaPendingAuthorization,
  type CibaRequest,
  type CibaTokenSet,
  createPendingApproval,
  logPendingApprovalHandoff,
  pollCibaTokenOnce,
} from "@zentity/sdk";
import type { DpopClient } from "@zentity/sdk/rp";
import { clientCapabilitiesOf } from "../agent.js";
import { config } from "../config.js";
import { discoverMcpOAuth } from "../oauth-client.js";
import type { OAuthSessionContext } from "../runtime/auth-context.js";

const INTERACTION_TTL_BUFFER_MS = 5000;
const APPROVAL_INPUT_KEY = "approval";

export interface InteractiveToolInteraction {
  expiresAt: string;
  message: string;
  mode: "url";
  url: string;
}

export type InteractiveToolOutcome<T> =
  | { data: T; status: "complete" }
  | { interaction: InteractiveToolInteraction; status: "needs_user_action" }
  | { status: "denied" | "expired" };

interface InteractiveToolFlowEntry {
  browserUrl: string;
  clientAuth?: NonNullable<OAuthSessionContext["clientAuth"]>;
  clientId: string;
  clientSecret?: string | undefined;
  dpopClient: DpopClient;
  expiresAt: number;
  pendingAuthorization: CibaPendingAuthorization;
  privateJwk?: CibaRequest["privateJwk"];
  tokenEndpoint: string;
}

/** What varies per tool call; the session and the endpoints fill in the rest. */
export type ApprovalRequest = Pick<
  CibaRequest,
  "agentAssertion" | "authorizationDetails" | "bindingMessage" | "scope"
>;

interface StartInteractiveFlowParams<T> {
  approval: ApprovalRequest;
  browserSearchParams?: Record<string, string | undefined>;
  /**
   * Creates the DPoP client a new flow polls with, for a flow whose token
   * must not be bound to the session's key (an x402 purchase). A resumed flow
   * keeps the client it started with.
   */
  createFlowDpopClient?: (() => Promise<DpopClient>) | undefined;
  fingerprint: string;
  oauth: OAuthSessionContext;
  /** Receives the token set and the DPoP client the token is bound to. */
  onApproved: (tokenSet: CibaTokenSet, dpopClient: DpopClient) => Promise<T>;
  toolName: "my_profile" | "purchase";
}

async function buildCibaRequest(
  oauth: OAuthSessionContext,
  approval: ApprovalRequest,
  dpopClient: DpopClient
): Promise<CibaRequest> {
  const discovery = await discoverMcpOAuth();
  if (!discovery.backchannel_authentication_endpoint) {
    throw new Error(
      "Zentity discovery does not advertise a backchannel authentication endpoint"
    );
  }
  return {
    ...approval,
    cibaEndpoint: discovery.backchannel_authentication_endpoint,
    clientId: oauth.clientId,
    ...(oauth.clientSecret ? { clientSecret: oauth.clientSecret } : {}),
    ...(oauth.clientAuth ? oauth.clientAuth : {}),
    dpopClient,
    loginHint: oauth.accountSub,
    resource: config.zentityUrl,
    tokenEndpoint: discovery.token_endpoint,
  };
}

const flows = new Map<string, InteractiveToolFlowEntry>();

function evictExpiredFlows(): void {
  const now = Date.now();
  for (const [fingerprint, entry] of flows) {
    if (entry.expiresAt <= now) {
      flows.delete(fingerprint);
    }
  }
}

function buildBrowserInteractionUrl(input: {
  authReqId: string;
  browserSearchParams?: Record<string, string | undefined> | undefined;
  toolName: "my_profile" | "purchase";
}): string {
  const url = new URL(
    `/mcp/interactive/${encodeURIComponent(randomUUID())}`,
    config.zentityUrl
  );
  url.searchParams.set("authReqId", input.authReqId);
  url.searchParams.set("tool", input.toolName);

  for (const [key, value] of Object.entries(input.browserSearchParams ?? {})) {
    if (typeof value === "string" && value.length > 0) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function needsUserAction(
  entry: InteractiveToolFlowEntry
): Extract<InteractiveToolOutcome<never>, { status: "needs_user_action" }> {
  return {
    status: "needs_user_action",
    interaction: {
      mode: "url",
      url: entry.browserUrl,
      message:
        "User action is required in the browser. Open the provided URL to continue this tool call.",
      expiresAt: new Date(entry.expiresAt).toISOString(),
    },
  };
}

async function resumeInteractiveFlow<T>(
  entry: InteractiveToolFlowEntry,
  params: StartInteractiveFlowParams<T>
): Promise<InteractiveToolOutcome<T>> {
  let poll: Awaited<ReturnType<typeof pollCibaTokenOnce>>;
  try {
    poll = await pollCibaTokenOnce(
      {
        clientId: entry.clientId,
        ...(entry.clientSecret ? { clientSecret: entry.clientSecret } : {}),
        ...(entry.clientAuth ?? {}),
        dpopClient: entry.dpopClient,
        tokenEndpoint: entry.tokenEndpoint,
      },
      entry.pendingAuthorization
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[interaction] Poll failed: ${message}`);
    return needsUserAction(entry);
  }

  if (poll.status === "pending") {
    entry.pendingAuthorization = poll.pendingAuthorization;
    return needsUserAction(entry);
  }

  flows.delete(params.fingerprint);
  if (poll.status === "approved") {
    return {
      status: "complete",
      data: await params.onApproved(poll.tokenSet, entry.dpopClient),
    };
  }
  return { status: poll.status === "denied" ? "denied" : "expired" };
}

/**
 * Starts a CIBA approval for the tool call, or polls the one already started
 * for the same fingerprint.
 */
export async function beginOrResumeInteractiveFlow<T>(
  params: StartInteractiveFlowParams<T>
): Promise<InteractiveToolOutcome<T>> {
  evictExpiredFlows();

  const existing = flows.get(params.fingerprint);
  if (existing) {
    return resumeInteractiveFlow(existing, params);
  }

  const dpopClient = params.createFlowDpopClient
    ? await params.createFlowDpopClient()
    : params.oauth.dpopClient;
  const cibaRequest = await buildCibaRequest(
    params.oauth,
    params.approval,
    dpopClient
  );
  const pendingAuthorization = await beginCibaApproval(cibaRequest);
  logPendingApprovalHandoff(
    createPendingApproval(cibaRequest, pendingAuthorization)
  );

  const entry: InteractiveToolFlowEntry = {
    pendingAuthorization,
    expiresAt:
      Date.now() +
      pendingAuthorization.expiresIn * 1000 +
      INTERACTION_TTL_BUFFER_MS,
    browserUrl: buildBrowserInteractionUrl({
      authReqId: pendingAuthorization.authReqId,
      browserSearchParams: params.browserSearchParams,
      toolName: params.toolName,
    }),
    clientId: params.oauth.clientId,
    ...(params.oauth.clientSecret
      ? { clientSecret: params.oauth.clientSecret }
      : {}),
    ...(params.oauth.clientAuth ? { clientAuth: params.oauth.clientAuth } : {}),
    dpopClient,
    tokenEndpoint: cibaRequest.tokenEndpoint,
  };
  flows.set(params.fingerprint, entry);

  return needsUserAction(entry);
}

/**
 * Asks a client that supports URL elicitation to open the approval page
 * in-band; every other client receives the structured `needs_user_action`
 * result, which carries the same URL.
 */
export function requestUserAction<R>(
  server: McpServer,
  ctx: ServerContext,
  interaction: InteractiveToolInteraction,
  result: R
): R | InputRequiredResult {
  const elicitsUrls =
    clientCapabilitiesOf(server, ctx)?.elicitation?.url !== undefined;
  const alreadyAsked = ctx.mcpReq.inputResponses?.[APPROVAL_INPUT_KEY];
  if (!elicitsUrls || alreadyAsked !== undefined) {
    return result;
  }

  return inputRequired({
    inputRequests: {
      [APPROVAL_INPUT_KEY]: inputRequired.elicitUrl({
        url: interaction.url,
        message: interaction.message,
      }),
    },
  });
}
