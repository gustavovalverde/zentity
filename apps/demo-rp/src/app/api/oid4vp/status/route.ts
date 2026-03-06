import { NextResponse } from "next/server";

import { getVpSession, updateVpSession } from "@/lib/oid4vp";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const session = await getVpSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Auto-expire if past TTL
  if (session.status === "pending" && new Date() > session.expiresAt) {
    await updateVpSession(sessionId, { status: "expired" });
    return NextResponse.json(
      { status: "expired", result: null },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  const result = session.result ? JSON.parse(session.result) : null;

  return NextResponse.json(
    { status: session.status, result },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
