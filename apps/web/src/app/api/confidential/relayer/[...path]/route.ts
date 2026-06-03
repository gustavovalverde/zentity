/**
 * Server-side proxy for the Zama confidential relayer.
 *
 * The browser SDK in `lib/blockchain/confidential/chain.tsx` points its
 * `relayerUrl` at this route instead of the upstream so we can:
 *   - inject `CONFIDENTIAL_RELAYER_API_KEY` server-side (never ships to clients),
 *   - require an authenticated browser session,
 *   - rate-limit per user to protect the shared API quota,
 *   - and forward only the headers the upstream actually consumes.
 */
import type { NextRequest } from "next/server";

import { env } from "@/env";
import { requireBrowserSession } from "@/lib/auth/resource-auth";
import {
  confidentialRelayerLimiter,
  rateLimitResponse,
} from "@/lib/http/rate-limit";
import { isSafePathSegments } from "@/lib/http/url-safety";
import { logger } from "@/lib/logging/logger";

export const runtime = "nodejs";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "content-length",
  "content-type",
]);

const RESPONSE_HEADER_DENYLIST = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-encoding",
  "content-length",
]);

// 2 MiB covers the largest FHE input proof we currently emit (~32 KiB) plus
// generous headroom for batched ciphertext bundles. Sized to fail fast on
// pathological bodies without truncating legitimate ones.
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const RELAYER_TIMEOUT_MS = 30_000;

function buildForwardHeaders(incomingHeaders: Headers): Headers {
  const forwardHeaders = new Headers();
  for (const [key, value] of incomingHeaders) {
    if (REQUEST_HEADER_ALLOWLIST.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  }

  if (env.CONFIDENTIAL_RELAYER_API_KEY) {
    forwardHeaders.set("x-api-key", env.CONFIDENTIAL_RELAYER_API_KEY);
  }

  return forwardHeaders;
}

function buildResponseHeaders(relayerHeaders: Headers): Headers {
  const responseHeaders = new Headers();
  for (const [key, value] of relayerHeaders) {
    if (!RESPONSE_HEADER_DENYLIST.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }
  return responseHeaders;
}

function isRequestBodyTooLarge(headers: Headers): boolean {
  const declared = headers.get("content-length");
  if (!declared) {
    return false;
  }
  const length = Number(declared);
  return Number.isFinite(length) && length > MAX_REQUEST_BODY_BYTES;
}

/**
 * Cap the forwarded body on the actual byte stream, not just the declared
 * `content-length`. A client that omits or understates the header is still cut
 * off here. `onExceeded` lets the caller map the resulting fetch failure to a
 * 413 rather than a generic 503.
 */
function enforceBodyByteLimit(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  onExceeded: () => void
): ReadableStream<Uint8Array> | null {
  if (!body) {
    return null;
  }
  let forwardedBytes = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        forwardedBytes += chunk.byteLength;
        if (forwardedBytes > maxBytes) {
          onExceeded();
          controller.error(new Error("Request body exceeds size limit"));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
}

async function proxyRelayerRequest(
  request: NextRequest,
  path: string[]
): Promise<Response> {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { limited, retryAfter } = confidentialRelayerLimiter.check(
    authResult.session.user.id
  );
  if (limited) {
    return rateLimitResponse(retryAfter);
  }

  if (!isSafePathSegments(path)) {
    return Response.json({ error: "Invalid relayer path" }, { status: 400 });
  }

  if (isRequestBodyTooLarge(request.headers)) {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }

  const upstreamUrl = new URL(
    path.join("/"),
    `${env.CONFIDENTIAL_RELAYER_URL}/`
  );
  upstreamUrl.search = request.nextUrl.search;

  let bodyTooLarge = false;
  const limitedBody = enforceBodyByteLimit(
    request.body,
    MAX_REQUEST_BODY_BYTES,
    () => {
      bodyTooLarge = true;
    }
  );

  let relayerResponse: Response;
  try {
    relayerResponse = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers: buildForwardHeaders(request.headers),
      body: limitedBody,
      signal: AbortSignal.timeout(RELAYER_TIMEOUT_MS),
      // @ts-expect-error -- Node fetch supports streaming request bodies.
      duplex: "half",
    });
  } catch (error) {
    if (bodyTooLarge) {
      return Response.json(
        { error: "Request body too large" },
        { status: 413 }
      );
    }
    logger.error(
      { err: error, upstreamUrl: upstreamUrl.toString() },
      "Confidential relayer proxy request failed"
    );
    return Response.json({ error: "Relayer unreachable" }, { status: 503 });
  }

  return new Response(relayerResponse.body, {
    status: relayerResponse.status,
    headers: buildResponseHeaders(relayerResponse.headers),
  });
}

interface RelayerRouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(
  request: NextRequest,
  context: RelayerRouteContext
): Promise<Response> {
  return proxyRelayerRequest(request, (await context.params).path);
}

export async function POST(
  request: NextRequest,
  context: RelayerRouteContext
): Promise<Response> {
  return proxyRelayerRequest(request, (await context.params).path);
}

export async function PUT(
  request: NextRequest,
  context: RelayerRouteContext
): Promise<Response> {
  return proxyRelayerRequest(request, (await context.params).path);
}

export async function PATCH(
  request: NextRequest,
  context: RelayerRouteContext
): Promise<Response> {
  return proxyRelayerRequest(request, (await context.params).path);
}

export async function DELETE(
  request: NextRequest,
  context: RelayerRouteContext
): Promise<Response> {
  return proxyRelayerRequest(request, (await context.params).path);
}
