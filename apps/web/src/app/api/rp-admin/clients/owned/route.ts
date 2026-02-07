import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireRpAdmin } from "@/lib/auth/rp-admin";
import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const admin = await requireRpAdmin(request.headers);
  if (!admin.ok) {
    return admin.response;
  }

  const clients = await db
    .select({
      clientId: oauthClients.clientId,
      name: oauthClients.name,
      scopes: oauthClients.scopes,
      redirectUris: oauthClients.redirectUris,
      disabled: oauthClients.disabled,
      createdAt: oauthClients.createdAt,
    })
    .from(oauthClients)
    .where(eq(oauthClients.referenceId, admin.organizationId))
    .all();

  return NextResponse.json({ clients }, { status: 200 });
}
