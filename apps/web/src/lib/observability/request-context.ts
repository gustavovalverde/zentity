import "server-only";

import { randomUUID } from "node:crypto";

import { type Attributes, trace } from "@opentelemetry/api";

import { hashIdentifier } from "@/lib/observability/telemetry";

const REQUEST_ID_HEADER = "x-request-id";
const CORRELATION_ID_HEADER = "x-correlation-id";
const FLOW_ID_HEADER = "x-zentity-flow-id";

type FlowIdSource = "header" | "cookie" | "query" | "none";

interface RequestContext {
  flowId: string | null;
  flowIdSource: FlowIdSource;
  requestId: string;
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
): Attributes {
  return {
    "request.id": context.requestId,
    "flow.id_hash": context.flowId ? hashIdentifier(context.flowId) : undefined,
    "flow.source": context.flowId ? context.flowIdSource : undefined,
  };
}

export function attachRequestContextToSpan(context: RequestContext): void {
  trace.getActiveSpan()?.setAttributes(getSpanAttributesFromContext(context));
}
