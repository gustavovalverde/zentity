import { eq } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import {
  humanityCredentials,
  identityBundles,
  identityVerifications,
} from "@/lib/db/schema/identity";

const FORBIDDEN_CLAIM_KEYS = [
  "chipNullifier",
  "chip_nullifier",
  "dedupKey",
  "dedup_key",
  "nullifierSeed",
  "nullifier_seed",
] as const;

export async function assertNoInternalIdentifiersInClaims(
  claims: Record<string, unknown>,
  userId: string
): Promise<void> {
  for (const key of FORBIDDEN_CLAIM_KEYS) {
    if (key in claims) {
      throw new Error(`Internal identifier key "${key}" leaked into claims`);
    }
  }

  const [bundle, verifications, credentials] = await Promise.all([
    db
      .select({ nullifierSeed: identityBundles.nullifierSeed })
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get(),
    db
      .select({
        chipNullifier: identityVerifications.chipNullifier,
        dedupKey: identityVerifications.dedupKey,
        nullifierSeed: identityVerifications.nullifierSeed,
      })
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .all(),
    db
      .select({ providerSubjectHash: humanityCredentials.providerSubjectHash })
      .from(humanityCredentials)
      .where(eq(humanityCredentials.userId, userId))
      .all(),
  ]);

  const secrets = new Set<string>();
  if (bundle?.nullifierSeed) {
    secrets.add(bundle.nullifierSeed);
  }
  for (const row of verifications) {
    if (row.chipNullifier) {
      secrets.add(row.chipNullifier);
    }
    if (row.dedupKey) {
      secrets.add(row.dedupKey);
    }
    if (row.nullifierSeed) {
      secrets.add(row.nullifierSeed);
    }
  }
  for (const row of credentials) {
    secrets.add(row.providerSubjectHash);
  }

  if (secrets.size === 0) {
    return;
  }

  const json = JSON.stringify(claims);
  for (const secret of secrets) {
    if (json.includes(secret)) {
      throw new Error("Raw internal identifier leaked into claims");
    }
  }

  if (typeof claims.sybil_nullifier === "string") {
    for (const secret of secrets) {
      if (claims.sybil_nullifier === secret) {
        throw new Error("sybil_nullifier matched a raw internal identifier");
      }
    }
  }
  if (typeof claims.rp_unique_humanity_id === "string") {
    for (const secret of secrets) {
      if (claims.rp_unique_humanity_id === secret) {
        throw new Error(
          "rp_unique_humanity_id matched a raw internal identifier"
        );
      }
    }
  }
}
