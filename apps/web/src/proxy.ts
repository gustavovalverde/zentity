import type { NextRequest } from "next/server";

import { NextResponse } from "next/server";

import {
  CORRELATION_ID_HEADER,
  FLOW_ID_HEADER,
  REQUEST_ID_HEADER,
  RESPONSE_FLOW_ID_HEADER,
  RESPONSE_REQUEST_ID_HEADER,
} from "@/lib/observability/correlation-headers";

function readHeader(headers: Headers, key: string): string | null {
  const value = headers.get(key);
  return value?.trim() ? value.trim() : null;
}

function resolveFlowId(request: NextRequest): string | null {
  return (
    readHeader(request.headers, FLOW_ID_HEADER) ||
    request.nextUrl.searchParams.get("flowId")
  );
}

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const existingRequestId =
    readHeader(headers, REQUEST_ID_HEADER) ||
    readHeader(headers, CORRELATION_ID_HEADER);
  const requestId = existingRequestId ?? crypto.randomUUID();

  if (!existingRequestId) {
    headers.set(REQUEST_ID_HEADER, requestId);
  }

  const flowId = resolveFlowId(request);

  const response = NextResponse.next({
    request: {
      headers,
    },
  });

  response.headers.set(RESPONSE_REQUEST_ID_HEADER, requestId);
  if (flowId) {
    response.headers.set(RESPONSE_FLOW_ID_HEADER, flowId);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
