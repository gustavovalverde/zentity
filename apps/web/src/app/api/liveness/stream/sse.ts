/**
 * Shared SSE stream registry for liveness routes.
 *
 * Note: This module is intentionally separate from route handlers so it can be
 * imported without violating Next.js route export constraints.
 */

interface StreamEntry {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  encoder: TextEncoder;
  lastActivity: number;
}

// In-memory store for SSE writers by session ID
// In production, this would need to be replaced with Redis or similar
const streamWriters = new Map<string, StreamEntry>();

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

export function getStreamWriter(sessionId: string) {
  return streamWriters.get(sessionId);
}

export function setStreamWriter(sessionId: string, entry: StreamEntry) {
  streamWriters.set(sessionId, entry);
}

export function deleteStreamWriter(sessionId: string) {
  streamWriters.delete(sessionId);
}

export async function closeStreamWriter(sessionId: string) {
  const entry = streamWriters.get(sessionId);
  if (!entry) {
    return;
  }
  try {
    await entry.writer.close();
  } catch {
    // Already closed
  }
  streamWriters.delete(sessionId);
}

export async function sendSSEEvent<T extends Record<string, unknown>>(
  sessionId: string,
  eventType: string,
  data: T
) {
  const entry = streamWriters.get(sessionId);
  if (!entry) {
    return false;
  }

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
