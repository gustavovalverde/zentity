import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";
import { agentCapabilities } from "@/lib/db/schema/agent";
import { ensureCapabilitiesSeeded } from "@/lib/db/seed/capabilities";

export const runtime = "nodejs";

export async function GET() {
  await ensureCapabilitiesSeeded();

  const capabilities = await db
    .select({
      name: agentCapabilities.name,
      description: agentCapabilities.description,
      inputSchema: agentCapabilities.inputSchema,
      outputSchema: agentCapabilities.outputSchema,
      approvalStrength: agentCapabilities.approvalStrength,
    })
    .from(agentCapabilities);

  return NextResponse.json(
    capabilities.map((c) => ({
      name: c.name,
      description: c.description,
      input_schema: c.inputSchema ? JSON.parse(c.inputSchema) : null,
      output_schema: c.outputSchema ? JSON.parse(c.outputSchema) : null,
      approval_strength: c.approvalStrength,
    }))
  );
}
