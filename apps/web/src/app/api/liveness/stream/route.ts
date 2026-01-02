/**
 * SSE Streaming Endpoint for Liveness Verification
 *
 * Provides real-time server feedback during liveness challenges.
 * The client connects to this endpoint and receives progress updates
 * as frames are processed by the /api/liveness/frame endpoint.
 */

import type { NextRequest } from "next/server";

import {
  closeStreamWriter,
  deleteStreamWriter,
  getStreamWriter,
  setStreamWriter,
} from "./sse";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  if (!sessionId) {
    return new Response("Missing sessionId parameter", { status: 400 });
  }

  // Clean up existing connection for this session
  const existing = getStreamWriter(sessionId);
  if (existing) {
    await closeStreamWriter(sessionId);
  }

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  // Store writer for frame processing endpoint
  setStreamWriter(sessionId, {
    writer,
    encoder,
    lastActivity: Date.now(),
  });

  // Send initial connection event
  await writer.write(
    encoder.encode(
      `data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`
    )
  );

  // Clean up when client disconnects
  req.signal.addEventListener("abort", () => {
    try {
      writer.close();
    } catch {
      // Already closed
    }
    deleteStreamWriter(sessionId);
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
