import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/connection";
import { oauthClients } from "@/lib/db/schema/oauth-provider";
import { organizations } from "@/lib/db/schema/organization";

export const runtime = "nodejs";

const AttachSchema = z.object({
  clientId: z.string().min(1),
  organizationId: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  allowMetadataUpdates: z.boolean().optional(),
  force: z.boolean().optional(),
});

function getAdminKey(headers: Headers): string | null {
  const value = headers.get("x-zentity-admin-key");
  return value?.trim() ? value.trim() : null;
}

export async function POST(request: Request): Promise<Response> {
  const expectedKey = process.env.ZENTITY_ADMIN_API_KEY;
  if (!expectedKey) {
    return NextResponse.json(
      { error: "Admin API key not configured." },
      { status: 500 }
    );
  }

  const providedKey = getAdminKey(request.headers);
  if (!providedKey || providedKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = AttachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { clientId, organizationId, scopes, allowMetadataUpdates, force } =
    parsed.data;

  const [client, organization] = await Promise.all([
    db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1)
      .get(),
    db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
      .get(),
  ]);

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  if (!organization) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 }
    );
  }

  if (client.referenceId && !force) {
    return NextResponse.json(
      { error: "Client is already owned. Use force to override." },
      { status: 409 }
    );
  }

  const existingMetadata =
    (client.metadata as Record<string, unknown> | null) ?? {};
  const nextMetadata =
    allowMetadataUpdates === undefined
      ? existingMetadata
      : {
          ...existingMetadata,
          allowMetadataUpdates,
        };

  const updates: Partial<typeof oauthClients.$inferInsert> = {
    referenceId: organizationId,
    userId: null,
    updatedAt: new Date(),
  };

  if (scopes) {
    updates.scopes = scopes;
  }
  if (allowMetadataUpdates !== undefined) {
    updates.metadata = nextMetadata;
  }

  await db
    .update(oauthClients)
    .set(updates)
    .where(eq(oauthClients.clientId, clientId))
    .run();

  return NextResponse.json({ success: true }, { status: 200 });
}
