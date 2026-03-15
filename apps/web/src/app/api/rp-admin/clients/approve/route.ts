import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { OAUTH_SCOPE_SET } from "@/lib/auth/oidc/oauth-scopes";
import { requireRpAdmin } from "@/lib/auth/rp-admin";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

export const runtime = "nodejs";

const ApproveSchema = z.object({
  clientId: z.string().min(1),
  scopes: z.array(z.string()).min(1).optional(),
  force: z.boolean().optional(),
});

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

  // Cross-org adoption requires the source org's approval (not implemented).
  // Block force-adoption of clients owned by a different organization.
  if (
    force &&
    existing.referenceId &&
    existing.referenceId !== admin.organizationId
  ) {
    return NextResponse.json(
      { error: "Cannot force-adopt a client owned by another organization" },
      { status: 403 }
    );
  }

  if (scopes) {
    const invalid = scopes.filter((s) => !OAUTH_SCOPE_SET.has(s));
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
      ...(scopes ? { scopes: JSON.stringify(scopes) } : {}),
    })
    .where(eq(oauthClients.clientId, clientId))
    .run();

  return NextResponse.json({ success: true }, { status: 200 });
}
