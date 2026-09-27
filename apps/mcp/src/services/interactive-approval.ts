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
  clientId: string;
  dpopClient: DpopClient;
  expiresAt: number;
  pendingAuthorization: CibaPendingAuthorization;
  tokenEndpoint: string;
}

interface StartInteractiveFlowParams<T> {
  browserSearchParams?: Record<string, string | undefined>;
  cibaRequest: CibaRequest;
  fingerprint: string;
  oauth: OAuthSessionContext;
  onApproved: (tokenSet: CibaTokenSet) => Promise<T>;
  toolName: "my_profile" | "purchase";
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
        dpopSigner: entry.dpopClient,
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
    return { status: "complete", data: await params.onApproved(poll.tokenSet) };
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

  const pendingAuthorization = await beginCibaApproval(params.cibaRequest);
  logPendingApprovalHandoff(
    createPendingApproval(params.cibaRequest, pendingAuthorization)
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
    dpopClient: params.oauth.dpopClient,
    tokenEndpoint: params.cibaRequest.tokenEndpoint,
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
