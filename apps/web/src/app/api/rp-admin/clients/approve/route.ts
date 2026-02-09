import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRpAdmin } from "@/lib/auth/rp-admin";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

export const runtime = "nodejs";

const ApproveSchema = z.object({
  clientId: z.string().min(1),
  scopes: z.array(z.string()).min(1).optional(),
  force: z.boolean().optional(),
});

// Keep in sync with oauthProvider({ scopes: [...] }) in `apps/web/src/lib/auth/auth.ts`.
const ALLOWED_OAUTH_SCOPES = new Set([
  "openid",
  "profile",
  "email",
  "offline_access",
  "proof:identity",
  "proof:verification",
  "proof:age",
  "proof:document",
  "proof:liveness",
  "proof:nationality",
  "proof:compliance",
  "compliance:key:read",
  "compliance:key:write",
  "identity",
  "identity.name",
  "identity.dob",
  "identity.address",
  "identity.document",
  "identity.nationality",
]);

export async function POST(request: Request): Promise<Response> {
  const admin = await requireRpAdmin(request.headers);
  if (!admin.ok) {
    return admin.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ApproveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { clientId, scopes, force } = parsed.data;

  const existing = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1)
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const isOwned = Boolean(existing.referenceId || existing.userId);
  if (isOwned && !force) {
    return NextResponse.json(
      { error: "Client is already owned. Use force to override." },
      { status: 409 }
    );
  }

  if (scopes) {
    const invalid = scopes.filter((s) => !ALLOWED_OAUTH_SCOPES.has(s));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: "Invalid scopes", invalid },
        { status: 400 }
      );
    }
  }

  await db
    .update(oauthClients)
    .set({
      referenceId: admin.organizationId,
      userId: null,
      updatedAt: new Date(),
      ...(scopes ? { scopes } : {}),
    })
    .where(eq(oauthClients.clientId, clientId))
    .run();

  return NextResponse.json({ success: true }, { status: 200 });
}
