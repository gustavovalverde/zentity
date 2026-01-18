import "server-only";

import { randomUUID } from "node:crypto";

import {
  CORRELATION_ID_HEADER,
  FLOW_ID_HEADER,
  REQUEST_ID_HEADER,
} from "@/lib/observability/correlation-headers";
import { currentSpan, hashIdentifier } from "@/lib/observability/telemetry";

type FlowIdSource = "header" | "cookie" | "query" | "none";
type SpanAttributeValue = string | number | boolean | undefined;
type SpanAttributes = Record<string, SpanAttributeValue>;

export interface RequestContext {
  requestId: string;
  flowId: string | null;
  flowIdSource: FlowIdSource;
}

function readHeader(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  return value?.trim() ? value.trim() : null;
}

export function resolveRequestContext(headers: Headers): RequestContext {
  const headerRequestId =
    readHeader(headers, REQUEST_ID_HEADER) ||
    readHeader(headers, CORRELATION_ID_HEADER);
  const headerFlowId = readHeader(headers, FLOW_ID_HEADER);

  const requestId = headerRequestId || randomUUID();
  const flowId = headerFlowId;
  const flowIdSource: FlowIdSource = flowId ? "header" : "none";

  return {
    requestId,
    flowId,
    flowIdSource,
  };
}

export function getRequestLogBindings(
  context: RequestContext
): Record<string, unknown> {
  return {
    requestId: context.requestId,
    flowIdHash: context.flowId ? hashIdentifier(context.flowId) : undefined,
    flowIdSource: context.flowId ? context.flowIdSource : undefined,
  };
}

export function getSpanAttributesFromContext(
  context: RequestContext
): SpanAttributes {
  return {
    "request.id": context.requestId,
    "flow.id_hash": context.flowId ? hashIdentifier(context.flowId) : undefined,
    "flow.source": context.flowId ? context.flowIdSource : undefined,
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
