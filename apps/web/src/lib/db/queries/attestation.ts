import type {
  AttestationEvidenceRecord,
  BlockchainAttestation,
} from "../schema/attestation";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../connection";
import {
  attestationEvidence,
  blockchainAttestations,
} from "../schema/attestation";

export async function upsertAttestationEvidence(args: {
  userId: string;
  documentId: string;
  policyVersion: string | null;
  policyHash: string | null;
  proofSetHash: string | null;
}): Promise<void> {
  await db
    .insert(attestationEvidence)
    .values({
      id: args.documentId,
      userId: args.userId,
      documentId: args.documentId,
      policyVersion: args.policyVersion,
      policyHash: args.policyHash,
      proofSetHash: args.proofSetHash,
    })
    .onConflictDoUpdate({
      target: [attestationEvidence.userId, attestationEvidence.documentId],
      set: {
        policyVersion: args.policyVersion,
        policyHash: args.policyHash,
        proofSetHash: args.proofSetHash,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run();
}

export async function getAttestationEvidenceByUserAndDocument(
  userId: string,
  documentId: string
): Promise<AttestationEvidenceRecord | null> {
  const row = await db
    .select()
    .from(attestationEvidence)
    .where(
      and(
        eq(attestationEvidence.userId, userId),
        eq(attestationEvidence.documentId, documentId)
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

export async function resetBlockchainAttestationForRetry(
  id: string
): Promise<void> {
  await db
    .update(blockchainAttestations)
    .set({
      status: "pending",
      errorMessage: null,
      updatedAt: sql`datetime('now')`,
    })
    .where(
      and(
        eq(blockchainAttestations.id, id),
        eq(blockchainAttestations.status, "failed")
      )
    )
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
