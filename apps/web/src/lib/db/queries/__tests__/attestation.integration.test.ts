import { beforeEach, describe, expect, it } from "vitest";

import {
  createBlockchainAttestation,
  deleteBlockchainAttestationsByUserId,
  getBlockchainAttestationByUserAndNetwork,
  getBlockchainAttestationsByUserId,
  resetBlockchainAttestationForRetry,
  updateBlockchainAttestationConfirmed,
  updateBlockchainAttestationFailed,
  updateBlockchainAttestationSubmitted,
  updateBlockchainAttestationWallet,
} from "@/lib/db/queries/attestation";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

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

    await resetBlockchainAttestationForRetry(attestation.id);
    row = await getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("pending");
    expect(row?.errorMessage).toBeNull();

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
});
