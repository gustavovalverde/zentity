import { and, eq } from "drizzle-orm";

import { getAssuranceForOAuth } from "@/lib/assurance/data";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import { evaluateBoundaries } from "@/lib/ciba/boundary-evaluation";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

interface CibaNotificationData {
  authorizationDetails?: unknown;
  authReqId: string;
  clientName?: string;
  scope: string;
  userId: string;
}

/**
 * Attempt to auto-approve a CIBA request based on agent boundaries.
 * Returns true if auto-approved, false if manual approval is needed.
 */
export async function tryAutoApprove(
  data: CibaNotificationData
): Promise<boolean> {
  const request = await db
    .select({
      acrValues: cibaRequests.acrValues,
      clientId: cibaRequests.clientId,
      status: cibaRequests.status,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, data.authReqId))
    .get();

  if (!request || request.status !== "pending") {
    return false;
  }

  if (request.acrValues) {
    const assurance = await getAssuranceForOAuth(data.userId);
    const satisfied = findSatisfiedAcr(request.acrValues, assurance.tier);
    if (!satisfied) {
      return false;
    }
  }

  const authDetails =
    typeof data.authorizationDetails === "string"
      ? data.authorizationDetails
      : null;

  const result = await evaluateBoundaries(
    data.userId,
    request.clientId,
    data.scope,
    authDetails
  );

  if (!result.autoApproved) {
    return false;
  }

  const updated = await db
    .update(cibaRequests)
    .set({ status: "approved", approvalMethod: "boundary" })
    .where(
      and(
        eq(cibaRequests.authReqId, data.authReqId),
        eq(cibaRequests.status, "pending")
      )
    )
    .returning({ id: cibaRequests.id });

  return updated.length > 0;
}
