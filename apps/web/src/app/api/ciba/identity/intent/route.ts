import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleIdentityIntent } from "@/lib/auth/oidc/identity-handler";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

const IntentSchema = z.object({
  auth_req_id: z.string().min(1),
  scopes: z.array(z.string()).min(1),
});

export function POST(request: Request): Promise<Response> {
  return handleIdentityIntent(request, async (body, userId) => {
    const parsed = IntentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { auth_req_id, scopes } = parsed.data;

    const cibaRequest = await db
      .select({
        clientId: cibaRequests.clientId,
        userId: cibaRequests.userId,
        scope: cibaRequests.scope,
        status: cibaRequests.status,
      })
      .from(cibaRequests)
      .where(eq(cibaRequests.authReqId, auth_req_id))
      .get();

    if (!cibaRequest) {
      return NextResponse.json(
        { error: "Unknown auth_req_id" },
        { status: 404 }
      );
    }

    if (cibaRequest.userId !== userId) {
      return NextResponse.json(
        { error: "CIBA request does not belong to current user" },
        { status: 403 }
      );
    }

    if (cibaRequest.status !== "pending") {
      return NextResponse.json(
        { error: "CIBA request is no longer pending" },
        { status: 400 }
      );
    }

    return {
      clientId: cibaRequest.clientId,
      authorizedScopes: cibaRequest.scope.split(" "),
      scopes,
      authReqId: auth_req_id,
    };
  });
}
