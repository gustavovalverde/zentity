import { and, eq, inArray, like, lt } from "drizzle-orm";

import { PAIRWISE_PROOF_CONSENT_REFERENCE_PREFIX } from "@/lib/auth/oidc/disclosure/claims";
import { db } from "@/lib/db/connection";
import { oauthConsents } from "@/lib/db/schema/oauth-provider";

export const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
const CONSENT_CLEANUP_BATCH_SIZE = 500;

/** Delete abandoned pairwise proof-only consents after their code can expire. */
export async function deleteExpiredPairwiseProofOnlyConsents(
  input: { clientId?: string; userId?: string; now?: Date } = {}
): Promise<number> {
  const now = input.now ?? new Date();
  const expiredBefore = new Date(now.getTime() - AUTHORIZATION_CODE_TTL_MS);
  const expiredIds = db
    .select({ id: oauthConsents.id })
    .from(oauthConsents)
    .where(
      and(
        like(
          oauthConsents.referenceId,
          `${PAIRWISE_PROOF_CONSENT_REFERENCE_PREFIX}%`
        ),
        lt(oauthConsents.createdAt, expiredBefore),
        input.clientId ? eq(oauthConsents.clientId, input.clientId) : undefined,
        input.userId ? eq(oauthConsents.userId, input.userId) : undefined
      )
    )
    .limit(CONSENT_CLEANUP_BATCH_SIZE);
  const deleted = await db
    .delete(oauthConsents)
    .where(inArray(oauthConsents.id, expiredIds))
    .run();
  return deleted.rowsAffected;
}
