import "server-only";

import { env } from "@/env";
import { getIdentityBundleByUserId } from "@/lib/db/queries/identity";
import { computeRpNullifier } from "@/lib/identity/verification/dedup";

/**
 * Resolve the per-RP `sybil_nullifier` for an access token. Returns `null`
 * when the user has no nullifier seed (unverified, revoked, or a verification
 * path that could not derive one).
 */
export async function resolveSybilNullifier(
  userId: string,
  clientId: string
): Promise<string | null> {
  const bundle = await getIdentityBundleByUserId(userId);
  if (!bundle?.nullifierSeed) {
    return null;
  }
  return computeRpNullifier(
    env.DEDUP_HMAC_SECRET,
    bundle.nullifierSeed,
    clientId
  );
}
