import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireBrowserSession } from "@/lib/auth/api-auth";
import { computeJwkThumbprint } from "@/lib/auth/oauth-token-validation";
import { db } from "@/lib/db/connection";
import { agentHosts } from "@/lib/db/schema/agent";

export const runtime = "nodejs";

const rotateKeySchema = z.object({
  hostId: z.string().min(1),
  publicKey: z.string().min(1),
});

export async function POST(request: Request) {
  const authResult = await requireBrowserSession(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = rotateKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const userId = authResult.session.user.id;
  const { hostId, publicKey } = parsed.data;
  const publicKeyThumbprint = await computeJwkThumbprint(publicKey);

  const conflictingHost = await db
    .select({ id: agentHosts.id })
    .from(agentHosts)
    .where(eq(agentHosts.publicKeyThumbprint, publicKeyThumbprint))
    .limit(1)
    .get();
  if (conflictingHost && conflictingHost.id !== hostId) {
    return NextResponse.json(
      { error: "Public key already belongs to another host" },
      { status: 409 }
    );
  }

  const updated = await db
    .update(agentHosts)
    .set({ publicKey, publicKeyThumbprint, updatedAt: new Date() })
    .where(and(eq(agentHosts.id, hostId), eq(agentHosts.userId, userId)))
    .returning({ id: agentHosts.id });

  if (updated.length === 0) {
    return NextResponse.json(
      { error: "Host not found or not owned by this user" },
      { status: 404 }
    );
  }

  return NextResponse.json({ rotated: true });
}
