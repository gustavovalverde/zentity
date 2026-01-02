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

export function upsertAttestationEvidence(args: {
  userId: string;
  documentId: string;
  policyVersion: string | null;
  policyHash: string | null;
  proofSetHash: string | null;
}): void {
  db.insert(attestationEvidence)
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

export function getAttestationEvidenceByUserAndDocument(
  userId: string,
  documentId: string
): AttestationEvidenceRecord | null {
  const row = db
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

export function createBlockchainAttestation(data: {
  userId: string;
  walletAddress: string;
  networkId: string;
  chainId: number;
}): BlockchainAttestation {
  const id = crypto.randomUUID();

  db.insert(blockchainAttestations)
    .values({
      id,
      userId: data.userId,
      walletAddress: data.walletAddress,
      networkId: data.networkId,
      chainId: data.chainId,
      status: "pending",
    })
    .run();

  const attestation = getBlockchainAttestationById(id);
  if (!attestation) {
    throw new Error("Failed to create blockchain attestation");
  }
  return attestation;
}

function getBlockchainAttestationById(
  id: string
): BlockchainAttestation | null {
  const row = db
    .select()
    .from(blockchainAttestations)
    .where(eq(blockchainAttestations.id, id))
    .limit(1)
    .get();

  return row ?? null;
}

export function getBlockchainAttestationByUserAndNetwork(
  userId: string,
  networkId: string
): BlockchainAttestation | null {
  const row = db
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

export function getBlockchainAttestationsByUserId(
  userId: string
): BlockchainAttestation[] {
  return db
    .select()
    .from(blockchainAttestations)
    .where(eq(blockchainAttestations.userId, userId))
    .orderBy(desc(blockchainAttestations.createdAt))
    .all();
}

export function updateBlockchainAttestationSubmitted(
  id: string,
  txHash: string
): void {
  db.update(blockchainAttestations)
    .set({
      status: "submitted",
      txHash,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export function updateBlockchainAttestationConfirmed(
  id: string,
  blockNumber: number | null
): void {
  db.update(blockchainAttestations)
    .set({
      status: "confirmed",
      blockNumber,
      confirmedAt: sql`datetime('now')`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export function updateBlockchainAttestationFailed(
  id: string,
  errorMessage: string
): void {
  db.update(blockchainAttestations)
    .set({
      status: "failed",
      errorMessage,
      retryCount: sql`${blockchainAttestations.retryCount} + 1`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export function resetBlockchainAttestationForRetry(id: string): void {
  db.update(blockchainAttestations)
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

export function updateBlockchainAttestationWallet(
  id: string,
  walletAddress: string,
  chainId: number
): void {
  db.update(blockchainAttestations)
    .set({
      walletAddress,
      chainId,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(blockchainAttestations.id, id))
    .run();
}

export function deleteBlockchainAttestationsByUserId(userId: string): void {
  db.delete(blockchainAttestations)
    .where(eq(blockchainAttestations.userId, userId))
    .run();
}
