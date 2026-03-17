import { and, eq } from "drizzle-orm";

import { getAssuranceForOAuth } from "@/lib/assurance/data";
import { findSatisfiedAcr } from "@/lib/auth/oidc/step-up";
import {
  evaluateBoundaries,
  normalizeAuthorizationDetails,
} from "@/lib/ciba/boundary-evaluation";
import { db } from "@/lib/db/connection";
import { cibaRequests } from "@/lib/db/schema/ciba";

interface CibaNotificationData {
  authorizationDetails?: unknown;
  authReqId: string;
  clientName?: string | undefined;
  scope: string;
  userId: string;
}

export type AutoApproveResult =
  | { approved: false }
  | {
      approved: true;
      clientNotificationEndpoint: string | null;
      clientNotificationToken: string | null;
      deliveryMode: string;
    };

/**
 * Attempt to auto-approve a CIBA request based on agent boundaries.
 * Returns delivery metadata when auto-approved so the caller can
 * trigger ping notifications without going through the plugin's
 * approve endpoint.
 */
export async function tryAutoApprove(
  data: CibaNotificationData
): Promise<AutoApproveResult> {
  const request = await db
    .select({
      acrValues: cibaRequests.acrValues,
      clientId: cibaRequests.clientId,
      clientNotificationEndpoint: cibaRequests.clientNotificationEndpoint,
      clientNotificationToken: cibaRequests.clientNotificationToken,
      deliveryMode: cibaRequests.deliveryMode,
      status: cibaRequests.status,
    })
    .from(cibaRequests)
    .where(eq(cibaRequests.authReqId, data.authReqId))
    .get();

  if (!request || request.status !== "pending") {
    return { approved: false };
  }

  if (request.acrValues) {
    const assurance = await getAssuranceForOAuth(data.userId);
    const satisfied = findSatisfiedAcr(request.acrValues, assurance.tier);
    if (!satisfied) {
      return { approved: false };
    }
  }

  const authDetails = normalizeAuthorizationDetails(data.authorizationDetails);

  const result = await evaluateBoundaries(
    data.userId,
    request.clientId,
    data.scope,
    authDetails
  );

  if (!result.autoApproved) {
    return { approved: false };
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

  if (updated.length === 0) {
    return { approved: false };
  }

  return {
    approved: true,
    clientNotificationEndpoint: request.clientNotificationEndpoint,
    clientNotificationToken: request.clientNotificationToken,
    deliveryMode: request.deliveryMode,
  };
}
