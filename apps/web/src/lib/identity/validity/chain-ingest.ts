import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { createPublicClient, http, parseAbiItem } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { getNetworkById } from "@/lib/blockchain/networks";
import { db } from "@/lib/db/connection";
import {
  getIdentityValiditySnapshot,
  getIdentityValiditySourceCursor,
  upsertIdentityValiditySourceCursor,
} from "@/lib/db/queries/identity-validity";
import {
  blockchainAttestations,
  identityBundles,
} from "@/lib/db/schema/identity";

import { recordValidityTransition } from "./transition";

const MAX_BLOCK_RANGE = 50_000;
const IDENTITY_ATTESTED_EVENT = parseAbiItem(
  "event IdentityAttested(address indexed user)"
);
const IDENTITY_REVOKED_EVENT = parseAbiItem(
  "event IdentityRevoked(address indexed user)"
);

function getViemChain(chainId: number) {
  switch (chainId) {
    case 11_155_111:
      return sepolia;
    case 31_337:
      return hardhat;
    default:
      return undefined;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("identity_validity_events_source_event_unique") ||
    error.message.includes("SQLITE_CONSTRAINT_UNIQUE")
  );
}

interface ChainLogMetadata {
  blockNumber?: bigint | null;
  logIndex?: number | null;
  transactionHash?: string | null;
}

function getLogBlockNumber(log: ChainLogMetadata): number | null {
  return log.blockNumber === null || log.blockNumber === undefined
    ? null
    : Number(log.blockNumber);
}

function getLogSourceEventId(log: ChainLogMetadata): string {
  return `${log.transactionHash ?? "unknown"}:${log.logIndex?.toString() ?? "0"}`;
}

function compareLogPosition(
  left: ChainLogMetadata,
  right: ChainLogMetadata
): number {
  const leftBlock = left.blockNumber ?? -1n;
  const rightBlock = right.blockNumber ?? -1n;
  if (leftBlock < rightBlock) {
    return -1;
  }
  if (leftBlock > rightBlock) {
    return 1;
  }

  return (left.logIndex ?? -1) - (right.logIndex ?? -1);
}

async function recordChainAttestationConfirmed(args: {
  blockNumber?: number | null;
  networkId: string;
  sourceEventId: string;
  userId: string;
}): Promise<boolean> {
  const snapshot = await getIdentityValiditySnapshot(args.userId);
  if (!snapshot) {
    return false;
  }

  try {
    await recordValidityTransition({
      userId: args.userId,
      verificationId: snapshot.effectiveVerificationId ?? null,
      eventKind: "verified",
      source: "chain",
      sourceEventId: args.sourceEventId,
      sourceNetwork: args.networkId,
      sourceBlockNumber: args.blockNumber ?? null,
      reason: "blockchain_attestation_confirmed",
    });

    return true;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return false;
    }

    throw error;
  }
}

export async function ingestChainValidityEvents(args: {
  fromBlock?: number;
  networkId: string;
}): Promise<{
  cursorAdvancedTo: number | null;
  eventsSeen: number;
  fromBlock: number;
  networkId: string;
  skippedDuplicate: number;
  skippedUnknownAttestation: number;
  skippedUnknownSubject: number;
  skippedUserAlreadyRevoked: number;
  attestationsConfirmed: number;
  toBlock: number;
  transitionsCreated: number;
}> {
  const network = getNetworkById(args.networkId);
  if (!(network?.enabled && network.contracts.identityRegistry)) {
    throw new Error(
      `Chain validity ingress is not configured for ${args.networkId}`
    );
  }

  const chain = getViemChain(network.chainId);
  if (!chain) {
    throw new Error(
      `Unsupported chain for validity ingress: ${network.chainId}`
    );
  }

  const client = createPublicClient({
    chain,
    transport: http(network.rpcUrl),
  });

  const currentBlock = Number(await client.getBlockNumber());
  const cursor = await getIdentityValiditySourceCursor("chain", args.networkId);
  const fromBlock =
    args.fromBlock ??
    (cursor?.lastSeenBlockNumber !== null &&
    cursor?.lastSeenBlockNumber !== undefined
      ? cursor.lastSeenBlockNumber + 1
      : Math.max(0, currentBlock - MAX_BLOCK_RANGE));
  const toBlock = Math.min(currentBlock, fromBlock + MAX_BLOCK_RANGE - 1);

  if (toBlock < fromBlock) {
    return {
      networkId: args.networkId,
      fromBlock,
      toBlock,
      eventsSeen: 0,
      attestationsConfirmed: 0,
      transitionsCreated: 0,
      skippedDuplicate: 0,
      skippedUnknownAttestation: 0,
      skippedUnknownSubject: 0,
      skippedUserAlreadyRevoked: 0,
      cursorAdvancedTo: cursor?.lastSeenBlockNumber ?? null,
    };
  }

  const [attestationLogs, revocationLogs] = await Promise.all([
    client.getLogs({
      address: network.contracts.identityRegistry as `0x${string}`,
      event: IDENTITY_ATTESTED_EVENT,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    }),
    client.getLogs({
      address: network.contracts.identityRegistry as `0x${string}`,
      event: IDENTITY_REVOKED_EVENT,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    }),
  ]);

  let attestationsConfirmed = 0;
  let transitionsCreated = 0;
  let skippedDuplicate = 0;
  let skippedUnknownAttestation = 0;
  let skippedUnknownSubject = 0;
  let skippedUserAlreadyRevoked = 0;

  const orderedLogs = [
    ...attestationLogs.map((log) => ({ kind: "attested" as const, log })),
    ...revocationLogs.map((log) => ({ kind: "revoked" as const, log })),
  ].sort((left, right) => compareLogPosition(left.log, right.log));

  const walletAddresses = new Set<string>();
  for (const { log } of orderedLogs) {
    if (typeof log.args.user === "string") {
      walletAddresses.add(log.args.user.toLowerCase());
    }
  }

  const attestationRows =
    walletAddresses.size === 0
      ? []
      : await db
          .select()
          .from(blockchainAttestations)
          .where(
            and(
              eq(blockchainAttestations.networkId, args.networkId),
              inArray(
                sql<string>`lower(${blockchainAttestations.walletAddress})`,
                [...walletAddresses]
              )
            )
          )
          .all();
  const attestationByWallet = new Map(
    attestationRows.map((attestation) => [
      attestation.walletAddress.toLowerCase(),
      attestation,
    ])
  );

  for (const event of orderedLogs) {
    const { log } = event;
    const walletAddress = log.args.user;
    if (typeof walletAddress !== "string") {
      continue;
    }

    if (event.kind === "revoked") {
      const attestation = attestationByWallet.get(walletAddress.toLowerCase());
      if (!attestation) {
        skippedUnknownSubject += 1;
        continue;
      }

      const sourceEventId = getLogSourceEventId(log);
      const occurredAt = new Date().toISOString();

      try {
        let createdTransition = false;

        await db.transaction(async (tx) => {
          const snapshot = await getIdentityValiditySnapshot(
            attestation.userId,
            tx
          );

          await tx
            .update(blockchainAttestations)
            .set({
              status: "revoked",
              revokedAt: occurredAt,
              blockNumber: getLogBlockNumber(log) ?? attestation.blockNumber,
              updatedAt: occurredAt,
            })
            .where(eq(blockchainAttestations.id, attestation.id))
            .run();

          if (snapshot?.validityStatus === "revoked") {
            skippedUserAlreadyRevoked += 1;
            return;
          }

          await tx
            .update(identityBundles)
            .set({
              effectiveVerificationId: null,
              nullifierSeed: null,
              updatedAt: occurredAt,
            })
            .where(eq(identityBundles.userId, attestation.userId))
            .run();

          await recordValidityTransition({
            executor: tx,
            userId: attestation.userId,
            verificationId: snapshot?.effectiveVerificationId ?? null,
            eventKind: "revoked",
            source: "chain",
            sourceEventId,
            sourceNetwork: args.networkId,
            sourceBlockNumber: getLogBlockNumber(log),
            occurredAt,
            reason: "blockchain_attestation_revoked",
            bundleSnapshot: {
              effectiveVerificationId: null,
              freshnessCheckedAt: snapshot?.freshnessCheckedAt ?? null,
              verificationExpiresAt: snapshot?.verificationExpiresAt ?? null,
              validityStatus: "revoked",
              revokedAt: occurredAt,
              revokedBy: "chain",
              revokedReason: "blockchain_attestation_revoked",
            },
          });

          createdTransition = true;
        });

        if (createdTransition) {
          transitionsCreated += 1;
        }
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          skippedDuplicate += 1;
          continue;
        }

        throw error;
      }

      continue;
    }

    const attestation = attestationByWallet.get(walletAddress.toLowerCase());
    if (!attestation) {
      skippedUnknownAttestation += 1;
      continue;
    }

    const sourceEventId = getLogSourceEventId(log);
    const blockNumber = getLogBlockNumber(log);

    await db
      .update(blockchainAttestations)
      .set({
        status: "confirmed",
        blockNumber,
        confirmedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(blockchainAttestations.id, attestation.id))
      .run();

    const created = await recordChainAttestationConfirmed({
      userId: attestation.userId,
      networkId: args.networkId,
      sourceEventId,
      blockNumber,
    });

    if (created) {
      attestationsConfirmed += 1;
    } else {
      skippedDuplicate += 1;
    }
  }

  const block =
    toBlock === 0
      ? null
      : await client.getBlock({ blockNumber: BigInt(toBlock) });

  await upsertIdentityValiditySourceCursor({
    source: "chain",
    network: args.networkId,
    cursor: String(toBlock),
    lastSeenBlockNumber: toBlock,
    lastSeenBlockHash: block?.hash ?? null,
  });

  return {
    networkId: args.networkId,
    fromBlock,
    toBlock,
    eventsSeen: attestationLogs.length + revocationLogs.length,
    attestationsConfirmed,
    transitionsCreated,
    skippedDuplicate,
    skippedUnknownAttestation,
    skippedUnknownSubject,
    skippedUserAlreadyRevoked,
    cursorAdvancedTo: toBlock,
  };
}
