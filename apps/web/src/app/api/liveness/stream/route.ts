/**
 * SSE Streaming Endpoint for Liveness Verification
 *
 * Provides real-time server feedback during liveness challenges.
 * The client connects to this endpoint and receives progress updates
 * as frames are processed by the /api/liveness/frame endpoint.
 */

import type { NextRequest } from "next/server";

// In-memory store for SSE writers by session ID
// In production, this would need to be replaced with Redis or similar
const streamWriters = new Map<
  string,
  {
    writer: WritableStreamDefaultWriter<Uint8Array>;
    encoder: TextEncoder;
    lastActivity: number;
  }
>();

// Clean up stale connections periodically (30 second timeout)
const STREAM_TIMEOUT_MS = 30_000;

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, entry] of streamWriters.entries()) {
    if (now - entry.lastActivity > STREAM_TIMEOUT_MS) {
      try {
        entry.writer.close();
      } catch {
        // Already closed
      }
      streamWriters.delete(sessionId);
    }
  }
}, 10_000);

/**
 * Get SSE writer for a session (used by frame processing endpoint)
 */
export function getStreamWriter(sessionId: string) {
  return streamWriters.get(sessionId);
}

/**
 * Send an event to a session's SSE stream
 */
export async function sendSSEEvent(
  sessionId: string,
  eventType: string,
  data: Record<string, unknown>,
) {
  const entry = streamWriters.get(sessionId);
  if (!entry) return false;

  try {
    const eventData = JSON.stringify({ type: eventType, ...data });
    await entry.writer.write(entry.encoder.encode(`data: ${eventData}\n\n`));
    entry.lastActivity = Date.now();
    return true;
  } catch {
    // Stream closed, clean up
    streamWriters.delete(sessionId);
    return false;
  }
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  if (!sessionId) {
    return new Response("Missing sessionId parameter", { status: 400 });
  }

  // Clean up existing connection for this session
  const existing = streamWriters.get(sessionId);
  if (existing) {
    try {
      await existing.writer.close();
    } catch {
      // Already closed
    }
    streamWriters.delete(sessionId);
  }

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  // Store writer for frame processing endpoint
  streamWriters.set(sessionId, {
    writer,
    encoder,
    lastActivity: Date.now(),
  });

  // Send initial connection event
  await writer.write(
    encoder.encode(
      `data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`,
    ),
  );

  // Clean up when client disconnects
  req.signal.addEventListener("abort", () => {
    try {
      writer.close();
    } catch {
      // Already closed
    }
    streamWriters.delete(sessionId);
  });

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering
    },
  });
}
