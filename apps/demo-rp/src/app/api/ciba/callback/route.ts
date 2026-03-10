import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { cibaPings } from "@/lib/db/schema";

/**
 * POST /api/ciba/callback — CIBA ping notification receiver.
 *
 * Zentity POSTs { auth_req_id } here after the user approves a ping-mode
 * CIBA request. The Authorization header carries the bearer token that was
 * sent with the original bc-authorize request.
 *
 * We verify the token matches what we stored, then mark the ping as
 * received so the client-side hook can detect it and fetch tokens.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 }
    );
  }
  const bearerToken = authHeader.slice(7);

  let body: { auth_req_id?: string };
  try {
    body = (await request.json()) as { auth_req_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const authReqId = body.auth_req_id;
  if (!authReqId) {
    return NextResponse.json({ error: "Missing auth_req_id" }, { status: 400 });
  }

  const db = getDb();

  // Look up the stored notification token for this auth_req_id
  const existing = await db.query.cibaPings.findFirst({
    where: eq(cibaPings.authReqId, authReqId),
  });

  if (!existing) {
    return NextResponse.json({ error: "Unknown auth_req_id" }, { status: 404 });
  }

  if (existing.notificationToken !== bearerToken) {
    return NextResponse.json(
      { error: "Invalid notification token" },
      { status: 403 }
    );
  }

  // Mark as received — the client hook will see this and fetch tokens
  await db
    .update(cibaPings)
    .set({ received: true })
    .where(eq(cibaPings.authReqId, authReqId));

  return NextResponse.json({ ok: true });
}
