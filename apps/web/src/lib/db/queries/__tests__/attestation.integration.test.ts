import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  createBlockchainAttestation,
  deleteBlockchainAttestationsByUserId,
  getBlockchainAttestationByUserAndNetwork,
  getBlockchainAttestationsByUserId,
  resetBlockchainAttestation,
  updateBlockchainAttestationConfirmed,
  updateBlockchainAttestationFailed,
  updateBlockchainAttestationSubmitted,
  updateBlockchainAttestationWallet,
} from "@/lib/db/queries/attestation";
import { blockchainAttestations } from "@/lib/db/schema/identity";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BACKDATED = "2000-01-01T00:00:00.000Z";

describe("attestation queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates and updates blockchain attestation lifecycle", async () => {
    const userId = await createTestUser();
    const attestation = await createBlockchainAttestation({
      userId,
      walletAddress: "0xabc",
      networkId: "sepolia",
      chainId: 11_155_111,
    });

    expect(attestation.status).toBe("pending");

    await updateBlockchainAttestationSubmitted(attestation.id, "0xtx");
    let row = await getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("submitted");
    expect(row?.txHash).toBe("0xtx");

    await updateBlockchainAttestationFailed(attestation.id, "boom");
    row = await getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toBe("boom");
    expect(row?.retryCount).toBe(1);

    await resetBlockchainAttestation(attestation.id);
    row = await getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("pending");
    expect(row?.errorMessage).toBeNull();
    expect(row?.txHash).toBeNull();
    expect(row?.blockNumber).toBeNull();
    expect(row?.confirmedAt).toBeNull();
    expect(row?.revokedAt).toBeNull();

    await updateBlockchainAttestationConfirmed(attestation.id, 123);
    row = await getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("confirmed");
    expect(row?.blockNumber).toBe(123);
    expect(row?.confirmedAt).not.toBeNull();

    await updateBlockchainAttestationWallet(attestation.id, "0xdef", 1);
    row = await getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.walletAddress).toBe("0xdef");
    expect(row?.chainId).toBe(1);

    const list = await getBlockchainAttestationsByUserId(userId);
    expect(list).toHaveLength(1);

    await deleteBlockchainAttestationsByUserId(userId);
    await expect(
      getBlockchainAttestationsByUserId(userId)
    ).resolves.toHaveLength(0);
  });

  it("refreshes updatedAt on updates that do not set it", async () => {
    const userId = await createTestUser();
    const attestation = await createBlockchainAttestation({
      userId,
      walletAddress: "0xabc",
      networkId: "sepolia",
      chainId: 11_155_111,
    });
    await db
      .update(blockchainAttestations)
      .set({ updatedAt: BACKDATED })
      .where(eq(blockchainAttestations.id, attestation.id))
      .run();

    await updateBlockchainAttestationSubmitted(attestation.id, "0xtx");

    const row = await getBlockchainAttestationByUserAndNetwork(
      userId,
      "sepolia"
    );
    expect(row?.updatedAt).toMatch(ISO_TIMESTAMP);
    expect(row?.updatedAt).not.toBe(BACKDATED);
  });
});
