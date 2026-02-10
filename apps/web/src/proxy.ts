import type { NextRequest } from "next/server";

import { NextResponse } from "next/server";

import {
  CORRELATION_ID_HEADER,
  FLOW_ID_HEADER,
  REQUEST_ID_HEADER,
  RESPONSE_FLOW_ID_HEADER,
  RESPONSE_REQUEST_ID_HEADER,
} from "@/lib/observability/correlation-headers";

const AUTH_PATH_PREFIX = "/api/auth";

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

function getAllowedOrigins(): string[] {
  const origins = new Set<string>();
  const fromEnv = process.env.TRUSTED_ORIGINS;
  if (fromEnv) {
    for (const origin of fromEnv.split(",")) {
      const trimmed = origin.trim();
      if (trimmed) {
        origins.add(trimmed);
      }
    }
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
    origins.add("http://[::1]:3000");
  }
  return Array.from(origins);
}

function getCorsOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }
  const allowed = getAllowedOrigins();
  return allowed.includes(origin) ? origin : null;
}

export function proxy(request: NextRequest) {
  const shouldApplyCors = request.nextUrl.pathname.startsWith(AUTH_PATH_PREFIX);
  const corsOrigin = shouldApplyCors ? getCorsOrigin(request) : null;

  if (shouldApplyCors && request.method === "OPTIONS") {
    const headers = new Headers();
    if (corsOrigin) {
      headers.set("Access-Control-Allow-Origin", corsOrigin);
      headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
    }
    return new NextResponse(null, { status: 204, headers });
  }

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

  if (corsOrigin) {
    response.headers.set("Access-Control-Allow-Origin", corsOrigin);
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
