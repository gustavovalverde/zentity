import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { createRequestLogger } from "@/lib/logging";
import { sanitizeLogMessage } from "@/lib/logging/redact";

type ClientErrorPayload = {
  name?: string;
  message?: string;
  digest?: string;
  path?: string;
  stack?: string;
};

function sanitizePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return new URL(path, "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId =
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    randomUUID();
  const log = createRequestLogger(requestId);

  let payload: ClientErrorPayload | null = null;
  try {
    payload = (await request.json()) as ClientErrorPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const safePath =
    payload && typeof payload.path === "string"
      ? sanitizePath(payload.path)
      : undefined;
  const safeMessage =
    payload && typeof payload.message === "string"
      ? sanitizeLogMessage(payload.message)
      : undefined;
  const safeStack =
    payload && typeof payload.stack === "string"
      ? sanitizeLogMessage(payload.stack)
      : undefined;

  log.error(
    {
      source: "client",
      digest: typeof payload?.digest === "string" ? payload.digest : undefined,
      name: typeof payload?.name === "string" ? payload.name : "Error",
      path: safePath,
      message: process.env.NODE_ENV === "production" ? undefined : safeMessage,
      stack: process.env.NODE_ENV === "production" ? undefined : safeStack,
    },
    "Client error boundary",
  );

  return NextResponse.json({ ok: true });
}
