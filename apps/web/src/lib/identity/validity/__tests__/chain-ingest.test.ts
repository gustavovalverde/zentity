import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetBlock, mockGetBlockNumber, mockGetLogs } = vi.hoisted(() => ({
  mockGetBlock: vi.fn(),
  mockGetBlockNumber: vi.fn(),
  mockGetLogs: vi.fn(),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");

  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlock: mockGetBlock,
      getBlockNumber: mockGetBlockNumber,
      getLogs: mockGetLogs,
    })),
    http: vi.fn((url: string) => url),
  };
});

const { mockNetwork } = vi.hoisted(() => ({
  mockNetwork: {
    id: "confidential_sepolia",
    name: "Zama Confidential Sepolia",
    chainId: 11_155_111,
    rpcUrl: "https://sepolia.example",
    registrarPrivateKey: "0xregistrar",
    type: "confidential",
    features: ["encrypted"],
    contracts: {
      identityRegistry: "0x0000000000000000000000000000000000000001",
    },
    enabled: true,
  },
}));

vi.mock("@/lib/blockchain/networks", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/blockchain/networks")
  >("@/lib/blockchain/networks");

  return {
    ...actual,
    getBaseSepoliaMirrorConfig: () => null,
    getNetworkById: () => mockNetwork,
  };
});

import { db } from "@/lib/db/connection";
import {
  createVerification,
  reconcileIdentityBundle,
} from "@/lib/db/queries/identity";
import {
  blockchainAttestations,
  identityValidityEvents,
} from "@/lib/db/schema/identity";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

import { ingestChainValidityEvents } from "../chain-ingest";
import { recordChainAttestationConfirmed } from "../transition";

const WALLET_ADDRESS = "0x0000000000000000000000000000000000000003";
const REVOCATION_TX =
  "0x00000000000000000000000000000000000000000000000000000000000000aa";
const ATTESTATION_TX =
  "0x00000000000000000000000000000000000000000000000000000000000000bb";

describe("ingestChainValidityEvents", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
    mockGetBlockNumber.mockResolvedValue(10n);
    mockGetBlock.mockResolvedValue({
      hash: "0x00000000000000000000000000000000000000000000000000000000000000cc",
    });
  });

  async function seedConfirmedAttestation() {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();
    const attestationId = crypto.randomUUID();

    await createVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: `dedup-${userId}`,
      verifiedAt: "2026-04-22T12:00:00Z",
    });
    await reconcileIdentityBundle(userId);
    await db
      .insert(blockchainAttestations)
      .values({
        id: attestationId,
        userId,
        status: "confirmed",
        chainId: 11_155_111,
        walletAddress: WALLET_ADDRESS,
        networkId: "confidential_sepolia",
        blockNumber: 9,
      })
      .run();

    return { attestationId, userId };
  }

  it("preserves block/log ordering for mixed revocation and attestation events", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();
    const attestationId = crypto.randomUUID();

    await createVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: `dedup-${userId}`,
      verifiedAt: "2026-04-22T12:00:00Z",
    });
    await reconcileIdentityBundle(userId);
    await db
      .insert(blockchainAttestations)
      .values({
        id: attestationId,
        userId,
        status: "confirmed",
        chainId: 11_155_111,
        walletAddress: WALLET_ADDRESS,
        networkId: "confidential_sepolia",
        blockNumber: 9,
      })
      .run();

    mockGetLogs
      .mockResolvedValueOnce([
        {
          args: { user: WALLET_ADDRESS },
          blockNumber: 10n,
          logIndex: 2,
          transactionHash: ATTESTATION_TX,
        },
      ])
      .mockResolvedValueOnce([
        {
          args: { user: WALLET_ADDRESS },
          blockNumber: 10n,
          logIndex: 1,
          transactionHash: REVOCATION_TX,
        },
      ]);

    const result = await ingestChainValidityEvents({
      networkId: "confidential_sepolia",
      fromBlock: 10,
    });

    const attestation = await db
      .select()
      .from(blockchainAttestations)
      .where(eq(blockchainAttestations.id, attestationId))
      .limit(1)
      .get();

    expect(result).toMatchObject({
      attestationsConfirmed: 1,
      eventsSeen: 2,
      skippedDuplicate: 0,
      transitionsCreated: 1,
    });
    expect(attestation?.status).toBe("confirmed");
    expect(attestation?.blockNumber).toBe(10);
  });

  it("treats a replayed chain revocation as a duplicate and keeps the attestation unrevoked", async () => {
    const { attestationId, userId } = await seedConfirmedAttestation();
    await db
      .insert(identityValidityEvents)
      .values({
        id: crypto.randomUUID(),
        userId,
        eventKind: "revoked",
        validityStatus: "revoked",
        source: "chain",
        sourceNetwork: "confidential_sepolia",
        sourceEventId: `${REVOCATION_TX}:1`,
      })
      .run();

    mockGetLogs.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        args: { user: WALLET_ADDRESS },
        blockNumber: 10n,
        logIndex: 1,
        transactionHash: REVOCATION_TX,
      },
    ]);

    const result = await ingestChainValidityEvents({
      networkId: "confidential_sepolia",
      fromBlock: 10,
    });

    const attestation = await db
      .select()
      .from(blockchainAttestations)
      .where(eq(blockchainAttestations.id, attestationId))
      .get();
    const events = await db.select().from(identityValidityEvents).all();

    expect(result).toMatchObject({
      skippedDuplicate: 1,
      transitionsCreated: 0,
    });
    expect(attestation?.status).toBe("confirmed");
    expect(events).toHaveLength(1);
  });
});

describe("recordChainAttestationConfirmed", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records a chain confirmation once and reports a replay as a duplicate", async () => {
    const userId = await createTestUser();
    await createVerification({
      id: crypto.randomUUID(),
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: `dedup-${userId}`,
      verifiedAt: "2026-04-22T12:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const args = {
      userId,
      networkId: "confidential_sepolia",
      sourceEventId: `${ATTESTATION_TX}:0`,
      blockNumber: 10,
    };

    await expect(recordChainAttestationConfirmed(args)).resolves.toBe(true);
    await expect(recordChainAttestationConfirmed(args)).resolves.toBe(false);

    const events = await db
      .select()
      .from(identityValidityEvents)
      .where(eq(identityValidityEvents.sourceEventId, args.sourceEventId))
      .all();
    expect(events).toHaveLength(1);
  });
});
