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

vi.mock("@/lib/blockchain/networks", () => ({
  getBaseSepoliaMirrorConfig: () => null,
  getNetworkById: () => ({
    id: "fhevm_sepolia",
    name: "fhEVM Sepolia",
    chainId: 11_155_111,
    rpcUrl: "https://sepolia.example",
    registrarPrivateKey: "0xregistrar",
    type: "fhevm",
    features: ["encrypted"],
    contracts: {
      identityRegistry: "0x0000000000000000000000000000000000000001",
    },
    enabled: true,
  }),
}));

import { db } from "@/lib/db/connection";
import {
  createVerification,
  reconcileIdentityBundle,
} from "@/lib/db/queries/identity";
import { blockchainAttestations } from "@/lib/db/schema/identity";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

import { ingestChainValidityEvents } from "../chain-ingest";

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
        networkId: "fhevm_sepolia",
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
      networkId: "fhevm_sepolia",
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
});
