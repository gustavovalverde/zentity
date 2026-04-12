import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AgentManagementError,
  revokeSessionForActor,
} from "@/lib/agents/management";
import { requireBootstrapAccessToken } from "@/lib/auth/api-auth";
import { AGENT_SESSION_REVOKE_SCOPE } from "@/lib/auth/oidc/agent";

export const runtime = "nodejs";

const revokeSchema = z.object({
  sessionId: z.string().min(1),
});

export async function POST(request: Request) {
  const authResult = await requireBootstrapAccessToken(request, [
    AGENT_SESSION_REVOKE_SCOPE,
  ]);
  if (!authResult.ok) {
    return authResult.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { sessionId } = parsed.data;

  try {
    const result = await revokeSessionForActor(
      {
        clientId: authResult.principal.clientId,
        kind: "delegated_machine",
        userId: authResult.principal.userId,
      },
      sessionId
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AgentManagementError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    throw error;
  }
}
