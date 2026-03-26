import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";
import { encodePacked, keccak256 } from "viem";

import { db } from "@/lib/db/connection";
import { proofArtifacts } from "@/lib/db/schema/crypto";

/**
 * Computes a deterministic hash of all verified proof artifacts for a
 * verification. The hash is a keccak256 over the sorted proof hashes,
 * matching the on-chain `proofSetHash` field in the attestation permit.
 *
 * Returns null if no verified proofs exist.
 */
export async function computeProofSetHash(
  userId: string,
  verificationId: string
): Promise<string | null> {
  const rows = await db
    .select({ proofHash: proofArtifacts.proofHash })
    .from(proofArtifacts)
    .where(
      and(
        eq(proofArtifacts.userId, userId),
        eq(proofArtifacts.verificationId, verificationId),
        eq(proofArtifacts.verified, true),
        isNotNull(proofArtifacts.proofHash)
      )
    )
    .all();

  if (rows.length === 0) {
    return null;
  }

  const sortedHashes = rows
    .map((r) => {
      const h = r.proofHash;
      return h.startsWith("0x") ? h : `0x${h}`;
    })
    .sort();

  return keccak256(
    encodePacked(
      sortedHashes.map(() => "bytes32" as const),
      sortedHashes.map((h) => h as `0x${string}`)
    )
  );
}
