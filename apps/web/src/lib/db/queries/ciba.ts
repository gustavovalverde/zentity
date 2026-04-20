import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

interface ValidatedCibaRequest {
  authorizationDetails: string | null | undefined;
  clientId: string;
  scope: string;
}

interface CibaRequestRow {
  authorizationDetails: string | null | undefined;
  clientId: string;
  scope: string;
  status: string;
  userId: string;
}

function fetchCibaRequest(
  authReqId: string
): Promise<CibaRequestRow | undefined> {
  return db
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
}

function validateOwnership(
  row: CibaRequestRow | undefined,
  userId: string
): { error: Response } | { row: CibaRequestRow } {
  if (!row) {
    return {
      error: NextResponse.json(
        { error: "Unknown auth_req_id" },
        { status: 404 }
      ),
    };
  }
  if (row.userId !== userId) {
    return {
      error: NextResponse.json(
        { error: "CIBA request does not belong to current user" },
        { status: 403 }
      ),
    };
  }
  return { row };
}

/**
 * Validate a CIBA request by authReqId: exists → belongs to userId → is pending.
 * Returns the row on success, or a NextResponse error on failure.
 */
export async function validatePendingCibaRequest(
  authReqId: string,
  userId: string
): Promise<ValidatedCibaRequest | Response> {
  const result = validateOwnership(await fetchCibaRequest(authReqId), userId);
  if ("error" in result) {
    return result.error;
  }

  if (result.row.status !== "pending") {
    return NextResponse.json(
      { error: "CIBA request is no longer pending" },
      { status: 400 }
    );
  }

  return {
    clientId: result.row.clientId,
    scope: result.row.scope,
    authorizationDetails: result.row.authorizationDetails,
  };
}

/**
 * Validate CIBA request ownership only (exists + belongs to userId).
 * Does NOT check status — suitable for cleanup operations like unstage
 * where PII removal should succeed regardless of request state.
 */
export async function validateCibaRequestOwnership(
  authReqId: string,
  userId: string
): Promise<{ clientId: string } | Response> {
  const result = validateOwnership(await fetchCibaRequest(authReqId), userId);
  if ("error" in result) {
    return result.error;
  }
  return { clientId: result.row.clientId };
}

export async function listPendingCibaRequestIdsByUserId(
  userId: string
): Promise<string[]> {
  const rows = await db
    .select({ authReqId: cibaRequests.authReqId })
    .from(cibaRequests)
    .where(
      and(eq(cibaRequests.userId, userId), eq(cibaRequests.status, "pending"))
    )
    .all();

  return rows.map((row) => row.authReqId);
}

export async function rejectPendingCibaRequest(
  authReqId: string
): Promise<boolean> {
  const result = await db
    .update(cibaRequests)
    .set({ status: "rejected" })
    .where(
      and(
        eq(cibaRequests.authReqId, authReqId),
        eq(cibaRequests.status, "pending")
      )
    )
    .run();

  return result.rowsAffected > 0;
}
