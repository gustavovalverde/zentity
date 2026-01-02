import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  createBlockchainAttestation,
  deleteBlockchainAttestationsByUserId,
  getAttestationEvidenceByUserAndDocument,
  getBlockchainAttestationByUserAndNetwork,
  getBlockchainAttestationsByUserId,
  resetBlockchainAttestationForRetry,
  updateBlockchainAttestationConfirmed,
  updateBlockchainAttestationFailed,
  updateBlockchainAttestationSubmitted,
  updateBlockchainAttestationWallet,
  upsertAttestationEvidence,
} from "@/lib/db/queries/attestation";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("attestation queries", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("upserts attestation evidence", () => {
    const userId = createTestUser();
    const documentId = crypto.randomUUID();

    upsertAttestationEvidence({
      userId,
      documentId,
      policyVersion: "policy-v1",
      policyHash: "hash-1",
      proofSetHash: "proof-1",
    });

    const evidence = getAttestationEvidenceByUserAndDocument(
      userId,
      documentId
    );
    expect(evidence?.policyVersion).toBe("policy-v1");
    expect(evidence?.proofSetHash).toBe("proof-1");

    upsertAttestationEvidence({
      userId,
      documentId,
      policyVersion: "policy-v2",
      policyHash: "hash-2",
      proofSetHash: "proof-2",
    });

    const updated = getAttestationEvidenceByUserAndDocument(userId, documentId);
    expect(updated?.policyVersion).toBe("policy-v2");
    expect(updated?.policyHash).toBe("hash-2");
    expect(updated?.proofSetHash).toBe("proof-2");
  });

  it("creates and updates blockchain attestation lifecycle", () => {
    const userId = createTestUser();
    const attestation = createBlockchainAttestation({
      userId,
      walletAddress: "0xabc",
      networkId: "sepolia",
      chainId: 11_155_111,
    });

    expect(attestation.status).toBe("pending");

    updateBlockchainAttestationSubmitted(attestation.id, "0xtx");
    let row = getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("submitted");
    expect(row?.txHash).toBe("0xtx");

    updateBlockchainAttestationFailed(attestation.id, "boom");
    row = getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toBe("boom");
    expect(row?.retryCount).toBe(1);

    resetBlockchainAttestationForRetry(attestation.id);
    row = getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("pending");
    expect(row?.errorMessage).toBeNull();

    updateBlockchainAttestationConfirmed(attestation.id, 123);
    row = getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.status).toBe("confirmed");
    expect(row?.blockNumber).toBe(123);
    expect(row?.confirmedAt).not.toBeNull();

    updateBlockchainAttestationWallet(attestation.id, "0xdef", 1);
    row = getBlockchainAttestationByUserAndNetwork(userId, "sepolia");
    expect(row?.walletAddress).toBe("0xdef");
    expect(row?.chainId).toBe(1);

    const list = getBlockchainAttestationsByUserId(userId);
    expect(list).toHaveLength(1);

    deleteBlockchainAttestationsByUserId(userId);
    expect(getBlockchainAttestationsByUserId(userId)).toHaveLength(0);
  });
});
