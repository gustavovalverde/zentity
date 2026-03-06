import { NextResponse } from "next/server";

import { getSignedRequest } from "@/lib/oid4vp";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  const jar = getSignedRequest(sessionId);
  if (!jar) {
    return NextResponse.json(
      { error: "Session not found or expired" },
      { status: 404 }
    );
  }

  // Return the signed JAR JWT as the appropriate content type
  return new Response(jar, {
    headers: {
      "Content-Type": "application/oauth-authz-req+jwt",
      "Cache-Control": "no-store",
    },
  });
}
