import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { getCachedSession } from "@/lib/auth/session";
import { jsonError } from "@/lib/http/route-responses";
import { LivenessErrorState } from "@/lib/identity/liveness/errors";
import { advanceFrame, MAX_FRAME_BYTES } from "@/lib/identity/liveness/session";

export async function POST(request: Request): Promise<Response> {
  const auth = await getCachedSession(await headers());
  if (!auth?.user) {
    return jsonError("Unauthorized", 401);
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return jsonError("Missing sessionId", 400);
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.byteLength === 0) {
    return jsonError("Empty frame", 400);
  }
  if (buffer.byteLength > MAX_FRAME_BYTES) {
    return jsonError("Frame too large", 413);
  }

  const outcome = await advanceFrame({
    sessionId,
    userId: auth.user.id,
    frame: buffer,
  });

  // Missing session and wrong-owner are indistinguishable on purpose, so a
  // session id cannot be probed for existence.
  if (!outcome) {
    return NextResponse.json(
      {
        phase: "failed",
        code: LivenessErrorState.SESSION_EXPIRED,
        message: "Session not found or expired",
        canRetry: false,
      },
      { status: 404 }
    );
  }

  return NextResponse.json(outcome);
}
