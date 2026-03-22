import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";
import { agentCapabilities } from "@/lib/db/schema/agent";
import { ensureCapabilitiesSeeded } from "@/lib/db/seed/capabilities";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  await ensureCapabilitiesSeeded();

  const capability = await db
    .select({
      name: agentCapabilities.name,
      description: agentCapabilities.description,
      inputSchema: agentCapabilities.inputSchema,
      outputSchema: agentCapabilities.outputSchema,
      approvalStrength: agentCapabilities.approvalStrength,
    })
    .from(agentCapabilities)
    .where(eq(agentCapabilities.name, name))
    .limit(1)
    .get();

  if (!capability) {
    return NextResponse.json(
      { error: "Capability not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    name: capability.name,
    description: capability.description,
    input_schema: capability.inputSchema
      ? JSON.parse(capability.inputSchema)
      : null,
    output_schema: capability.outputSchema
      ? JSON.parse(capability.outputSchema)
      : null,
    approval_strength: capability.approvalStrength,
  });
}
