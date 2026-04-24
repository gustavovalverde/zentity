import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config.js";
import type { OAuthSessionContext } from "../runtime/auth-context.js";
import type { DpopKeyPair } from "../runtime/dpop-proof.js";
import {
  beginCibaApproval,
  type CibaPendingApproval,
  type CibaPendingAuthorization,
  type CibaPollResult,
  type CibaRequest,
  type CibaTokenSet,
  createPendingApproval,
  logPendingApprovalHandoff,
  pollCibaTokenOnce,
} from "./ciba.js";

const INTERACTION_TTL_BUFFER_MS = 5000;
const NOTIFICATION_RETRY_MS = 1000;
const TERMINAL_RESULT_RETENTION_MS = 60_000;

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
  approval: CibaPendingApproval;
  browserUrl: string;
  clientId: string;
  completionNotifier?: (() => Promise<void>) | undefined;
  dpopKey: DpopKeyPair;
  expiresAt: number;
  fingerprint: string;
  interactionId: string;
  notificationRetryTimer?: ReturnType<typeof setTimeout> | undefined;
  notificationSent?: boolean;
  pendingAuthorization: CibaPendingAuthorization;
  pollPromise?: Promise<CibaPollResult | undefined> | undefined;
  pollTimer?: ReturnType<typeof setTimeout> | undefined;
  terminalResult?:
    | Extract<CibaPollResult, { status: "approved" }>
    | Extract<CibaPollResult, { status: "denied" | "timed_out" }>
    | undefined;
  terminalResultAt?: number | undefined;
  tokenEndpoint: string;
}

interface StartInteractiveFlowParams<T> {
  browserSearchParams?: Record<string, string | undefined>;
  cibaRequest: CibaRequest;
  fingerprint: string;
  oauth: OAuthSessionContext;
  onApproved: (tokenSet: CibaTokenSet) => Promise<T>;
  server: McpServer;
  toolName: "my_profile" | "purchase";
}

const flowsByFingerprint = new Map<string, InteractiveToolFlowEntry>();
const flowsById = new Map<string, InteractiveToolFlowEntry>();

function fireAndForget(promise: Promise<unknown>): void {
  promise.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[interaction] Background task failed: ${message}`);
  });
}

function evictExpiredInteractiveFlows(): void {
  const now = Date.now();
  for (const entry of flowsById.values()) {
    if (entry.terminalResult) {
      if (
        entry.terminalResultAt &&
        entry.terminalResultAt + TERMINAL_RESULT_RETENTION_MS <= now
      ) {
        deleteInteractiveFlow(entry);
      }
      continue;
    }

    if (entry.expiresAt <= now) {
      entry.terminalResult = { status: "timed_out" };
      entry.terminalResultAt = now;
      fireAndForget(notifyClientCompletion(entry));
    }
  }
}

function getClientSupportsUrlElicitation(server: McpServer): boolean {
  return server.server.getClientCapabilities()?.elicitation?.url !== undefined;
}

function buildBrowserInteractionUrl(input: {
  approval: CibaPendingApproval;
  browserSearchParams?: Record<string, string | undefined> | undefined;
  interactionId: string;
  toolName: "my_profile" | "purchase";
}): string {
  const url = new URL(
    `/mcp/interactive/${encodeURIComponent(input.interactionId)}`,
    config.zentityUrl
  );
  url.searchParams.set("authReqId", input.approval.authReqId);
  url.searchParams.set("tool", input.toolName);

  for (const [key, value] of Object.entries(input.browserSearchParams ?? {})) {
    if (typeof value === "string" && value.length > 0) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function buildInteraction(
  entry: InteractiveToolFlowEntry
): InteractiveToolInteraction {
  return {
    mode: "url",
    url: entry.browserUrl,
    message:
      "User action is required in the browser. Open the provided URL to continue this tool call.",
    expiresAt: new Date(entry.expiresAt).toISOString(),
  };
}

function storeInteractiveFlow(entry: InteractiveToolFlowEntry): void {
  flowsById.set(entry.interactionId, entry);
  flowsByFingerprint.set(entry.fingerprint, entry);
}

function deleteInteractiveFlow(entry: InteractiveToolFlowEntry): void {
  if (entry.notificationRetryTimer) {
    clearTimeout(entry.notificationRetryTimer);
    entry.notificationRetryTimer = undefined;
  }
  if (entry.pollTimer) {
    clearTimeout(entry.pollTimer);
    entry.pollTimer = undefined;
  }
  flowsById.delete(entry.interactionId);
  flowsByFingerprint.delete(entry.fingerprint);
}

function syncPendingApproval(
  entry: InteractiveToolFlowEntry,
  pendingAuthorization: CibaPendingAuthorization
): void {
  entry.pendingAuthorization = pendingAuthorization;
  entry.approval = {
    ...entry.approval,
    expiresIn: Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
    intervalSeconds: pendingAuthorization.intervalSeconds,
  };
}

function setTerminalResult(
  entry: InteractiveToolFlowEntry,
  terminalResult: Extract<
    CibaPollResult,
    { status: "approved" | "denied" | "timed_out" }
  >
): void {
  entry.terminalResult = terminalResult;
  entry.terminalResultAt = Date.now();

  if (entry.pollTimer) {
    clearTimeout(entry.pollTimer);
    entry.pollTimer = undefined;
  }
}

async function notifyClientCompletion(
  entry: InteractiveToolFlowEntry
): Promise<void> {
  if (!entry.completionNotifier || entry.notificationSent) {
    return;
  }

  entry.notificationSent = true;

  try {
    await entry.completionNotifier();
  } catch (error) {
    entry.notificationSent = false;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[interaction] Failed to send elicitation completion for ${entry.interactionId}: ${message}`
    );

    if (entry.terminalResult && flowsById.has(entry.interactionId)) {
      if (entry.notificationRetryTimer) {
        clearTimeout(entry.notificationRetryTimer);
      }
      const timer = setTimeout(() => {
        entry.notificationRetryTimer = undefined;
        fireAndForget(notifyClientCompletion(entry));
      }, NOTIFICATION_RETRY_MS);
      timer.unref?.();
      entry.notificationRetryTimer = timer;
    }
  }
}

function scheduleInteractiveFlowPoll(
  entry: InteractiveToolFlowEntry,
  delayMs = entry.pendingAuthorization.intervalSeconds * 1000
): void {
  if (entry.terminalResult) {
    return;
  }

  if (entry.pollTimer) {
    clearTimeout(entry.pollTimer);
  }

  const remainingMs = entry.expiresAt - Date.now();
  if (remainingMs <= 0) {
    setTerminalResult(entry, { status: "timed_out" });
    fireAndForget(notifyClientCompletion(entry));
    return;
  }

  const timer = setTimeout(
    () => {
      fireAndForget(pollInteractiveFlow(entry));
    },
    Math.max(250, Math.min(delayMs, remainingMs))
  );
  timer.unref?.();
  entry.pollTimer = timer;
}

function pollInteractiveFlow(
  entry: InteractiveToolFlowEntry
): Promise<CibaPollResult | undefined> {
  if (entry.terminalResult) {
    return Promise.resolve(entry.terminalResult);
  }

  if (entry.pollPromise) {
    return entry.pollPromise;
  }

  entry.pollPromise = (async () => {
    try {
      const pollResult = await pollCibaTokenOnce(
        {
          clientId: entry.clientId,
          dpopKey: entry.dpopKey,
          tokenEndpoint: entry.tokenEndpoint,
        },
        entry.pendingAuthorization
      );

      if (!flowsById.has(entry.interactionId)) {
        return pollResult;
      }

      if (pollResult.status === "pending") {
        syncPendingApproval(entry, pollResult.pendingAuthorization);
        scheduleInteractiveFlowPoll(
          entry,
          pollResult.pendingAuthorization.intervalSeconds * 1000
        );
        return {
          status: "pending",
          pendingAuthorization: entry.pendingAuthorization,
        } satisfies CibaPollResult;
      }

      setTerminalResult(entry, pollResult);
      await notifyClientCompletion(entry);
      return pollResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[interaction] Poll failed for ${entry.interactionId}: ${message}`
      );

      if (flowsById.has(entry.interactionId) && !entry.terminalResult) {
        scheduleInteractiveFlowPoll(entry, 1000);
      }

      return undefined;
    } finally {
      entry.pollPromise = undefined;
    }
  })();

  return entry.pollPromise;
}

export function throwUrlElicitationIfSupported(
  server: McpServer,
  outcome: Extract<
    InteractiveToolOutcome<unknown>,
    { status: "needs_user_action" }
  >
): void {
  if (!getClientSupportsUrlElicitation(server)) {
    return;
  }

  const entry = Array.from(flowsById.values()).find(
    (flow) => flow.browserUrl === outcome.interaction.url
  );
  if (!entry) {
    return;
  }

  throw new UrlElicitationRequiredError([
    {
      mode: "url",
      url: outcome.interaction.url,
      message: outcome.interaction.message,
      elicitationId: entry.interactionId,
    },
  ]);
}

export async function beginOrResumeInteractiveFlow<T>(
  params: StartInteractiveFlowParams<T>
): Promise<InteractiveToolOutcome<T>> {
  evictExpiredInteractiveFlows();

  const existing = flowsByFingerprint.get(params.fingerprint);
  if (
    existing &&
    (existing.expiresAt > Date.now() || existing.terminalResult)
  ) {
    if (existing.terminalResult && !existing.notificationSent) {
      fireAndForget(notifyClientCompletion(existing));
    }

    const pollResult = await pollInteractiveFlow(existing);

    if (pollResult?.status === "approved") {
      const approvedData = await params.onApproved(pollResult.tokenSet);
      deleteInteractiveFlow(existing);
      return {
        status: "complete",
        data: approvedData,
      };
    }

    if (pollResult?.status === "pending" || !pollResult) {
      return {
        status: "needs_user_action",
        interaction: buildInteraction(existing),
      };
    }

    if (pollResult.status === "denied" || pollResult.status === "timed_out") {
      deleteInteractiveFlow(existing);
      return {
        status: pollResult.status === "denied" ? "denied" : "expired",
      };
    }
  }

  const pendingAuthorization = await beginCibaApproval(params.cibaRequest);
  const approval = createPendingApproval(
    params.cibaRequest,
    pendingAuthorization
  );
  logPendingApprovalHandoff(approval);

  const interactionId = randomUUID();
  const completionNotifier = getClientSupportsUrlElicitation(params.server)
    ? params.server.server.createElicitationCompletionNotifier(interactionId)
    : undefined;
  const browserUrl = buildBrowserInteractionUrl({
    approval,
    browserSearchParams: params.browserSearchParams,
    interactionId,
    toolName: params.toolName,
  });

  const entry: InteractiveToolFlowEntry = {
    interactionId,
    fingerprint: params.fingerprint,
    approval,
    pendingAuthorization,
    expiresAt:
      Date.now() +
      pendingAuthorization.expiresIn * 1000 +
      INTERACTION_TTL_BUFFER_MS,
    browserUrl,
    completionNotifier,
    clientId: params.oauth.clientId,
    dpopKey: params.oauth.dpopKey,
    tokenEndpoint: params.cibaRequest.tokenEndpoint,
  };
  storeInteractiveFlow(entry);
  scheduleInteractiveFlowPoll(entry);

  return {
    status: "needs_user_action",
    interaction: buildInteraction(entry),
  };
}
