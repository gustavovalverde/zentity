import { sql } from "drizzle-orm";
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
      redirectUris: oauthClients.redirectUris,
      scopes: oauthClients.scopes,
      createdAt: oauthClients.createdAt,
    })
    .from(oauthClients)
    .where(
      sql`${oauthClients.referenceId} is null and ${oauthClients.userId} is null`
    )
    .orderBy(sql`${oauthClients.createdAt} desc`)
    .all();

  return NextResponse.json({ clients }, { status: 200 });
}
