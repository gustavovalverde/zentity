import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getClientIp,
  publicLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
import { createRequestLogger } from "@/lib/logging/logger";
import { sanitizeLogMessage } from "@/lib/logging/redact";
import {
  attachRequestContextToSpan,
  getRequestLogBindings,
  resolveRequestContext,
} from "@/lib/observability/request-context";

// A malformed or oversized field is dropped rather than failing the report.
const boundedString = (max: number) =>
  z.string().max(max).optional().catch(undefined);

const clientErrorSchema = z.object({
  digest: boundedString(200),
  message: boundedString(2000),
  name: boundedString(200),
  path: boundedString(2000),
  stack: boundedString(10_000),
});

function sanitizePath(path: string | undefined): string | undefined {
  if (!path) {
    return;
  }
  try {
    return new URL(path, "http://localhost").pathname;
  } catch {
    return;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { limited, retryAfter } = publicLimiter.check(
    getClientIp(request.headers)
  );
  if (limited) {
    return rateLimitResponse(retryAfter) as NextResponse;
  }

  const requestContext = resolveRequestContext(request.headers);
  attachRequestContextToSpan(requestContext);
  const log = createRequestLogger(
    requestContext.requestId,
    getRequestLogBindings(requestContext)
  );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const payload = clientErrorSchema.catch({}).parse(body);
  const safePath = sanitizePath(payload.path);
  const safeMessage = payload.message
    ? sanitizeLogMessage(payload.message)
    : undefined;
  const safeStack = payload.stack
    ? sanitizeLogMessage(payload.stack)
    : undefined;

  log.error(
    {
      source: "client",
      digest: payload.digest,
      name: payload.name ?? "Error",
      path: safePath,
      message: process.env.NODE_ENV === "production" ? undefined : safeMessage,
      stack: process.env.NODE_ENV === "production" ? undefined : safeStack,
    },
    "Client error boundary"
  );

  return NextResponse.json({ ok: true });
}
