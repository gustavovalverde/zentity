import "server-only";

import { randomUUID } from "node:crypto";

import { getSessionFromCookieHeader } from "@/lib/db/onboarding-session";
import {
  CORRELATION_ID_HEADER,
  FLOW_ID_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/correlation-headers";
import { currentSpan, hashIdentifier } from "@/lib/observability/telemetry";

type FlowIdSource = "header" | "cookie" | "query" | "none";

export interface RequestContext {
  requestId: string;
  flowId: string | null;
  flowIdSource: FlowIdSource;
  onboardingSessionId: string | null;
  onboardingStep?: number;
  identityDraftId?: string | null;
}

function readHeader(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  return value?.trim() ? value.trim() : null;
}

export async function resolveRequestContext(
  headers: Headers
): Promise<RequestContext> {
  const headerRequestId =
    readHeader(headers, REQUEST_ID_HEADER) ||
    readHeader(headers, CORRELATION_ID_HEADER);
  const headerFlowId = readHeader(headers, FLOW_ID_HEADER);

  const requestId = headerRequestId || randomUUID();

  const cookieHeader = readHeader(headers, "cookie");
  const onboardingSession = await getSessionFromCookieHeader(cookieHeader);

  const cookieFlowId = onboardingSession?.id ?? null;
  const flowId = headerFlowId || cookieFlowId;
  let flowIdSource: FlowIdSource = "none";
  if (headerFlowId) {
    flowIdSource = "header";
  } else if (cookieFlowId) {
    flowIdSource = "cookie";
  }

  return {
    requestId,
    flowId,
    flowIdSource,
    onboardingSessionId: onboardingSession?.id ?? null,
    onboardingStep: onboardingSession?.step ?? undefined,
    identityDraftId: onboardingSession?.identityDraftId ?? undefined,
  };
}

export function getRequestLogBindings(
  context: RequestContext
): Record<string, unknown> {
  return {
    requestId: context.requestId,
    flowIdHash: context.flowId ? hashIdentifier(context.flowId) : undefined,
    flowIdSource: context.flowId ? context.flowIdSource : undefined,
    onboardingSessionIdHash: context.onboardingSessionId
      ? hashIdentifier(context.onboardingSessionId)
      : undefined,
    onboardingStep: context.onboardingStep ?? undefined,
    onboardingDraftIdHash: context.identityDraftId
      ? hashIdentifier(context.identityDraftId)
      : undefined,
  };
}

export function getSpanAttributesFromContext(
  context: RequestContext
): Record<string, string | number | boolean | undefined> {
  return {
    "request.id": context.requestId,
    "flow.id_hash": context.flowId ? hashIdentifier(context.flowId) : undefined,
    "flow.source": context.flowId ? context.flowIdSource : undefined,
    "onboarding.session_id_hash": context.onboardingSessionId
      ? hashIdentifier(context.onboardingSessionId)
      : undefined,
    "onboarding.step": context.onboardingStep ?? undefined,
    "onboarding.draft_id_hash": context.identityDraftId
      ? hashIdentifier(context.identityDraftId)
      : undefined,
  };
}

export function attachRequestContextToSpan(context: RequestContext): void {
  const span = currentSpan();
  if (!span) {
    return;
  }
  const attrs = getSpanAttributesFromContext(context);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      span.setAttribute(key, value);
    }
  }
}
