import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createVpSession } from "@/lib/oid4vp";

export async function POST(request: Request) {
  const body = (await request.json()) as { scenarioId?: string };
  if (!body.scenarioId) {
    return NextResponse.json({ error: "Missing scenarioId" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("demo-rp.session_token")?.value ?? null;

  try {
    const { sessionId, authorizationUri } = await createVpSession(
      body.scenarioId,
      sessionCookie
    );
    return NextResponse.json({ sessionId, authorizationUri });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create VP session" },
      { status: 500 }
    );
  }
}
