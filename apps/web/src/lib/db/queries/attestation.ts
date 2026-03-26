import type {
  AttestationEvidenceRecord,
  BlockchainAttestation,
} from "../schema/attestation";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  canCreateProvider,
  createProvider,
} from "@/lib/blockchain/providers/factory";

import { db } from "../connection";
import {
  attestationEvidence,
  blockchainAttestations,
} from "../schema/attestation";

export async function upsertAttestationEvidence(args: {
  consentScope?: string | undefined;
  policyHash: string | null;
  policyVersion: string | null;
  proofSetHash: string | null | undefined;
  userId: string;
  verificationId: string;
}): Promise<void> {
  const now = new Date().toISOString();

  await db
    .insert(attestationEvidence)
    .values({
      id: args.verificationId,
      userId: args.userId,
      verificationId: args.verificationId,
      policyVersion: args.policyVersion,
      policyHash: args.policyHash,
      proofSetHash: args.proofSetHash ?? null,
      consentScope: args.consentScope ?? null,
      consentedAt: args.consentScope ? now : null,
    })
    .onConflictDoUpdate({
      target: [attestationEvidence.userId, attestationEvidence.verificationId],
      set: {
        policyVersion: args.policyVersion,
        policyHash: args.policyHash,
        ...(args.proofSetHash === undefined
          ? {}
          : { proofSetHash: args.proofSetHash }),
        ...(args.consentScope
          ? { consentScope: args.consentScope, consentedAt: now }
          : {}),
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();
}

export async function getAttestationEvidenceByUserAndVerification(
  userId: string,
  verificationId: string
): Promise<AttestationEvidenceRecord | null> {
  const row = await db
    .select()
    .from(attestationEvidence)
    .where(
      and(
        eq(attestationEvidence.userId, userId),
        eq(attestationEvidence.verificationId, verificationId)
      )
    )
    .limit(1)
    .get();

  return row ?? null;
}

export async function createBlockchainAttestation(data: {
  userId: string;
  walletAddress: string;
  networkId: string;
  chainId: number;
}): Promise<BlockchainAttestation> {
  const id = crypto.randomUUID();

  await db
    .insert(blockchainAttestations)
    .values({
      id,
      userId: data.userId,
      walletAddress: data.walletAddress,
      networkId: data.networkId,
      chainId: data.chainId,
      status: "pending",
    })
    .run();

  const attestation = await getBlockchainAttestationById(id);
  if (!attestation) {
    throw new Error("Failed to create blockchain attestation");
  }
  return attestation;
}

async function getBlockchainAttestationById(
  id: string
): Promise<BlockchainAttestation | null> {
  const row = await db
    .select()
    .from(blockchainAttestations)
    .where(eq(blockchainAttestations.id, id))
    .limit(1)
    .get();

  return row ?? null;
}

export async function getBlockchainAttestationByUserAndNetwork(
  userId: string,
  networkId: string
): Promise<BlockchainAttestation | null> {
  const row = await db
    .select()
    .from(blockchainAttestations)
    .where(
      and(
        eq(blockchainAttestations.userId, userId),
        eq(blockchainAttestations.networkId, networkId)
      )
    )
    .limit(1)
    .get();

  return row ?? null;
}

export async function getBlockchainAttestationsByUserId(
  userId: string
): Promise<BlockchainAttestation[]> {
  return await db
    .select()
    .from(blockchainAttestations)
    .where(eq(blockchainAttestations.userId, userId))
    .orderBy(desc(blockchainAttestations.createdAt))
    .all();
}

export async function updateBlockchainAttestationSubmitted(
  id: string,
  txHash: string
): Promise<void> {
  await db
    .update(blockchainAttestations)
    .set({
      status: "submitted",
      txHash,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export async function updateBlockchainAttestationConfirmed(
  id: string,
  blockNumber: number | null
): Promise<void> {
  await db
    .update(blockchainAttestations)
    .set({
      status: "confirmed",
      blockNumber,
      confirmedAt: sql`datetime('now')`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export async function updateBlockchainAttestationFailed(
  id: string,
  errorMessage: string
): Promise<void> {
  await db
    .update(blockchainAttestations)
    .set({
      status: "failed",
      errorMessage,
      retryCount: sql`${blockchainAttestations.retryCount} + 1`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export async function resetBlockchainAttestation(id: string): Promise<void> {
  await db
    .update(blockchainAttestations)
    .set({
      status: "pending",
      txHash: null,
      blockNumber: null,
      confirmedAt: null,
      revokedAt: null,
      errorMessage: null,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export async function updateBlockchainAttestationWallet(
  id: string,
  walletAddress: string,
  chainId: number
): Promise<void> {
  await db
    .update(blockchainAttestations)
    .set({
      walletAddress,
      chainId,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export async function deleteBlockchainAttestationsByUserId(
  userId: string
): Promise<void> {
  await db
    .delete(blockchainAttestations)
    .where(eq(blockchainAttestations.userId, userId))
    .run();
}

const MAX_REVOCATION_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

/**
 * Retry pending on-chain revocations with exponential backoff.
 * Returns the count of successfully revoked attestations.
 */
export async function reconcilePendingRevocations(): Promise<{
  retried: number;
  succeeded: number;
  failed: number;
}> {
  const pending = await db
    .select({
      id: blockchainAttestations.id,
      walletAddress: blockchainAttestations.walletAddress,
      networkId: blockchainAttestations.networkId,
      retryCount: blockchainAttestations.retryCount,
    })
    .from(blockchainAttestations)
    .where(eq(blockchainAttestations.status, "revocation_pending"))
    .all();

  let succeeded = 0;
  let failed = 0;

  for (const row of pending) {
    if (row.retryCount >= MAX_REVOCATION_RETRIES) {
      failed++;
      continue;
    }

    if (!canCreateProvider(row.networkId)) {
      failed++;
      continue;
    }

    const delayMs = BACKOFF_BASE_MS * 3 ** row.retryCount;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      const provider = await createProvider(row.networkId);
      await provider.revokeAttestation(row.walletAddress);

      await db
        .update(blockchainAttestations)
        .set({
          status: "revoked",
          updatedAt: sql`datetime('now')`,
        })
        .where(eq(blockchainAttestations.id, row.id))
        .run();
      succeeded++;
    } catch {
      await db
        .update(blockchainAttestations)
        .set({
          retryCount: sql`${blockchainAttestations.retryCount} + 1`,
          updatedAt: sql`datetime('now')`,
        })
        .where(eq(blockchainAttestations.id, row.id))
        .run();
      failed++;
    }
  }

  return { retried: pending.length, succeeded, failed };
}
