import type {
  AttestationEvidenceRecord,
  BlockchainAttestation,
} from "../schema/identity";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../connection";
import {
  attestationEvidence,
  blockchainAttestations,
} from "../schema/identity";

type AttestationExecutor = Pick<typeof db, "insert" | "select" | "update">;

export async function upsertAttestationEvidence(
  args: {
    consentReceipt?: string | undefined;
    consentScope?: string | undefined;
    policyHash: string | null;
    policyVersion: string | null;
    proofSetHash: string | null | undefined;
    userId: string;
    verificationId: string;
  },
  executor: AttestationExecutor = db
): Promise<void> {
  const now = new Date().toISOString();
  const consentedAt = args.consentReceipt || args.consentScope ? now : null;

  await executor
    .insert(attestationEvidence)
    .values({
      id: args.verificationId,
      userId: args.userId,
      verificationId: args.verificationId,
      policyVersion: args.policyVersion,
      policyHash: args.policyHash,
      proofSetHash: args.proofSetHash ?? null,
      consentReceipt: args.consentReceipt ?? null,
      consentScope: args.consentScope ?? null,
      consentedAt,
    })
    .onConflictDoUpdate({
      target: [attestationEvidence.userId, attestationEvidence.verificationId],
      set: {
        policyVersion: args.policyVersion,
        policyHash: args.policyHash,
        ...(args.proofSetHash === undefined
          ? {}
          : { proofSetHash: args.proofSetHash }),
        ...(args.consentReceipt
          ? { consentReceipt: args.consentReceipt, consentedAt: now }
          : {}),
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

export async function getBlockchainAttestationByNetworkAndWallet(
  networkId: string,
  walletAddress: string
): Promise<BlockchainAttestation | null> {
  const normalizedWalletAddress = walletAddress.toLowerCase();

  const row = await db
    .select()
    .from(blockchainAttestations)
    .where(eq(blockchainAttestations.networkId, networkId))
    .all();

  return (
    row.find(
      (candidate) =>
        candidate.walletAddress.toLowerCase() === normalizedWalletAddress
    ) ?? null
  );
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

export async function updateBlockchainAttestationRevoked(
  id: string,
  revokedAt: string,
  blockNumber?: number | null
): Promise<void> {
  await db
    .update(blockchainAttestations)
    .set({
      status: "revoked",
      revokedAt,
      ...(blockNumber === undefined ? {} : { blockNumber }),
      updatedAt: revokedAt,
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
