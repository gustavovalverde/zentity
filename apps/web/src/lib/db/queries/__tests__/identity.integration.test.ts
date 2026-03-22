import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  createVerification,
  dedupKeyExistsForOtherUser,
  getIdentityBundleByUserId,
  getLatestVerification,
  updateIdentityBundleStatus,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("identity queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("upserts and updates identity bundle status", async () => {
    const userId = await createTestUser();

    await upsertIdentityBundle({
      userId,
      walletAddress: "0xabc",
      status: "pending",
      policyVersion: "policy-v1",
    });

    const initial = await getIdentityBundleByUserId(userId);
    expect(initial?.walletAddress).toBe("0xabc");
    expect(initial?.status).toBe("pending");
    expect(initial?.policyVersion).toBe("policy-v1");

    await updateIdentityBundleStatus({
      userId,
      status: "verified",
      policyVersion: "policy-v2",
      issuerId: "issuer-1",
      attestationExpiresAt: "2025-01-01T00:00:00Z",
    });

    const updated = await getIdentityBundleByUserId(userId);
    expect(updated?.status).toBe("verified");
    expect(updated?.policyVersion).toBe("policy-v2");
    expect(updated?.issuerId).toBe("issuer-1");
    expect(updated?.attestationExpiresAt).toBe("2025-01-01T00:00:00Z");
  });

  it("returns latest verified identity document", async () => {
    const userId = await createTestUser();
    const olderDoc = crypto.randomUUID();
    const newerDoc = crypto.randomUUID();

    await createVerification({
      id: olderDoc,
      userId,
      method: "ocr",
      documentHash: "hash-old",
      nameCommitment: "commit-old",
      verifiedAt: "2024-01-01T00:00:00Z",
      confidenceScore: 0.9,
      status: "verified",
    });

    await createVerification({
      id: newerDoc,
      userId,
      method: "ocr",
      documentHash: "hash-new",
      dedupKey: "dedup-latest",
      nameCommitment: "commit-new",
      verifiedAt: "2025-01-01T00:00:00Z",
      confidenceScore: 0.95,
      status: "verified",
    });

    const latest = await getLatestVerification(userId);
    expect(latest?.id).toBe(newerDoc);
    // Dedup key: same user re-verifying is allowed, other user is blocked
    const otherUser = await createTestUser({ email: "other@test.com" });
    await expect(
      dedupKeyExistsForOtherUser("dedup-latest", userId)
    ).resolves.toBe(false);
    await expect(
      dedupKeyExistsForOtherUser("dedup-latest", otherUser)
    ).resolves.toBe(true);
  });
});
