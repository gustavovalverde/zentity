import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

export interface ValidatedCibaRequest {
  authorizationDetails: string | null | undefined;
  clientId: string;
  scope: string;
}

/**
 * Validate a CIBA request by authReqId: exists → belongs to userId → is pending.
 * Returns the row on success, or a NextResponse error on failure.
 */
export async function validatePendingCibaRequest(
  authReqId: string,
  userId: string
): Promise<ValidatedCibaRequest | Response> {
  const cibaRequest = await db
    .select({
      clientId: cibaRequests.clientId,
      userId: cibaRequests.userId,
      scope: cibaRequests.scope,
      status: cibaRequests.status,
      authorizationDetails: cibaRequests.authorizationDetails,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, authReqId))
    .get();

  if (!cibaRequest) {
    return NextResponse.json({ error: "Unknown auth_req_id" }, { status: 404 });
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
    scope: cibaRequest.scope,
    authorizationDetails: cibaRequest.authorizationDetails,
  };
}
