import "server-only";

import { eq } from "drizzle-orm";
import { createPublicClient, http, parseAbiItem } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { getNetworkById } from "@/lib/blockchain/networks";
import { db } from "@/lib/db/connection";
import { getBlockchainAttestationByNetworkAndWallet } from "@/lib/db/queries/attestation";
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

export async function ingestChainRevocations(args: {
  fromBlock?: number;
  networkId: string;
}): Promise<{
  cursorAdvancedTo: number | null;
  eventsSeen: number;
  fromBlock: number;
  networkId: string;
  skippedDuplicate: number;
  skippedUnknownSubject: number;
  skippedUserAlreadyRevoked: number;
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
      transitionsCreated: 0,
      skippedDuplicate: 0,
      skippedUnknownSubject: 0,
      skippedUserAlreadyRevoked: 0,
      cursorAdvancedTo: cursor?.lastSeenBlockNumber ?? null,
    };
  }

  const logs = await client.getLogs({
    address: network.contracts.identityRegistry as `0x${string}`,
    event: IDENTITY_REVOKED_EVENT,
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
  });

  let transitionsCreated = 0;
  let skippedDuplicate = 0;
  let skippedUnknownSubject = 0;
  let skippedUserAlreadyRevoked = 0;

  for (const log of logs) {
    const walletAddress = log.args.user;
    if (typeof walletAddress !== "string") {
      continue;
    }

    const attestation = await getBlockchainAttestationByNetworkAndWallet(
      args.networkId,
      walletAddress
    );
    if (!attestation) {
      skippedUnknownSubject += 1;
      continue;
    }

    const sourceEventId = `${log.transactionHash ?? "unknown"}:${log.logIndex?.toString() ?? "0"}`;
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
            blockNumber:
              log.blockNumber === null || log.blockNumber === undefined
                ? attestation.blockNumber
                : Number(log.blockNumber),
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
            rpNullifierSeed: null,
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
          sourceBlockNumber:
            log.blockNumber === null || log.blockNumber === undefined
              ? null
              : Number(log.blockNumber),
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
    eventsSeen: logs.length,
    transitionsCreated,
    skippedDuplicate,
    skippedUnknownSubject,
    skippedUserAlreadyRevoked,
    cursorAdvancedTo: toBlock,
  };
}
