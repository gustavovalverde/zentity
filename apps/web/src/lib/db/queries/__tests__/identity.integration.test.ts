import crypto from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  createVerification,
  dedupKeyExistsForOtherUser,
  deleteIdentityData,
  getAccountIdentity,
  getIdentityBundleByUserId,
  getLatestVerification,
  reconcileIdentityBundle,
  revokeIdentity,
  updateIdentityBundleAttestationState,
  upsertIdentityBundle,
  upsertVerification,
} from "@/lib/db/queries/identity";
import {
  identityBundles,
  identityValidityEvents,
  identityVerifications,
} from "@/lib/db/schema/identity";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

describe("identity queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("upserts bundle validity and updates attestation state", async () => {
    const userId = await createTestUser();

    await upsertIdentityBundle({
      userId,
      walletAddress: "0xabc",
      validityStatus: "pending",
      policyVersion: "policy-v1",
    });

    const initial = await getIdentityBundleByUserId(userId);
    expect(initial?.effectiveVerificationId).toBeNull();
    expect(initial?.walletAddress).toBe("0xabc");
    expect(initial?.validityStatus).toBe("pending");
    expect(initial?.policyVersion).toBe("policy-v1");

    await updateIdentityBundleAttestationState({
      userId,
      policyVersion: "policy-v2",
      issuerId: "issuer-1",
      attestationExpiresAt: "2025-01-01T00:00:00Z",
    });

    const updated = await getIdentityBundleByUserId(userId);
    expect(updated?.validityStatus).toBe("pending");
    expect(updated?.policyVersion).toBe("policy-v2");
    expect(updated?.issuerId).toBe("issuer-1");
    expect(updated?.attestationExpiresAt).toBe("2025-01-01T00:00:00Z");
  });

  it("freezes the RP nullifier seed while promoting a newer verified NFC credential", async () => {
    const userId = await createTestUser();
    const ocrVerificationId = crypto.randomUUID();
    const nfcVerificationId = crypto.randomUUID();

    await upsertIdentityBundle({
      userId,
      validityStatus: "pending",
    });

    await createVerification({
      id: ocrVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-seed-ocr",
      documentHash: "hash-ocr",
      verifiedAt: "2025-01-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const seededBundle = await getIdentityBundleByUserId(userId);
    const seededVerification = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.id, ocrVerificationId))
      .get();

    expect(seededBundle?.effectiveVerificationId).toBe(ocrVerificationId);
    expect(seededBundle?.rpNullifierSeed).toBe("dedup-seed-ocr");
    expect(seededBundle?.validityStatus).toBe("verified");
    expect(seededVerification?.method).toBe("ocr");

    await createVerification({
      id: nfcVerificationId,
      userId,
      method: "nfc_chip",
      status: "verified",
      uniqueIdentifier: "nfc-credential-123",
      verifiedAt: "2025-02-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const accountIdentity = await getAccountIdentity(userId);
    const promotedBundle = await getIdentityBundleByUserId(userId);
    const promotedVerification = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.id, nfcVerificationId))
      .get();

    expect(accountIdentity.effectiveVerification?.id).toBe(nfcVerificationId);
    expect(accountIdentity.groupedCredentials).toHaveLength(2);
    expect(promotedBundle?.effectiveVerificationId).toBe(nfcVerificationId);
    expect(promotedBundle?.rpNullifierSeed).toBe("dedup-seed-ocr");
    expect(promotedBundle?.validityStatus).toBe("verified");
    expect(promotedVerification?.method).toBe("nfc_chip");
  });

  it("does not seed the RP nullifier from failed or pending credentials before a verification succeeds", async () => {
    const userId = await createTestUser();
    const failedVerificationId = crypto.randomUUID();
    const verifiedVerificationId = crypto.randomUUID();

    await createVerification({
      id: failedVerificationId,
      userId,
      method: "ocr",
      status: "failed",
      dedupKey: "dedup-failed-attempt",
      documentHash: "hash-failed",
    });

    await getAccountIdentity(userId);

    const beforeVerifiedBundle = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get();
    expect(beforeVerifiedBundle).toBeUndefined();

    await createVerification({
      id: verifiedVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-verified-attempt",
      documentHash: "hash-verified",
      verifiedAt: "2025-03-01T00:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    const afterVerifiedBundle = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .get();
    expect(afterVerifiedBundle?.rpNullifierSeed).toBe("dedup-verified-attempt");
    expect(afterVerifiedBundle?.effectiveVerificationId).toBe(
      verifiedVerificationId
    );
  });

  it("freezes the original OCR dedup key when a pending verification is promoted to verified", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();

    await upsertIdentityBundle({
      userId,
      validityStatus: "pending",
    });

    await createVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "pending",
      dedupKey: "dedup-promoted-ocr",
      documentHash: "hash-promoted-ocr",
    });

    await upsertVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      verifiedAt: "2025-05-01T00:00:00Z",
      documentHash: "hash-promoted-ocr",
    });
    await reconcileIdentityBundle(userId);

    const [bundle, verification] = await Promise.all([
      getIdentityBundleByUserId(userId),
      db
        .select()
        .from(identityVerifications)
        .where(eq(identityVerifications.id, verificationId))
        .get(),
    ]);

    expect(bundle?.validityStatus).toBe("verified");
    expect(bundle?.effectiveVerificationId).toBe(verificationId);
    expect(bundle?.rpNullifierSeed).toBe("dedup-promoted-ocr");
    expect(verification?.status).toBe("verified");
    expect(verification?.dedupKey).toBe("dedup-promoted-ocr");
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

  it("allows same-user re-verification with the same dedup key", async () => {
    const userId = await createTestUser();
    const originalId = crypto.randomUUID();
    const reverifyId = crypto.randomUUID();

    await createVerification({
      id: originalId,
      userId,
      method: "ocr",
      documentHash: "hash-original",
      dedupKey: "dedup-repeat",
      status: "verified",
      verifiedAt: "2025-01-01T00:00:00Z",
    });

    await createVerification({
      id: reverifyId,
      userId,
      method: "ocr",
      documentHash: "hash-reverify",
      dedupKey: "dedup-repeat",
      status: "pending",
    });

    const rows = await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .all();

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([originalId, reverifyId])
    );
  });

  it("deletes validity history alongside other identity data", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();

    await createVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-delete-history",
      documentHash: "hash-delete-history",
      verifiedAt: "2025-04-01T00:00:00Z",
    });

    await reconcileIdentityBundle(userId);
    await revokeIdentity(userId, "admin@zentity.app", "cleanup", "admin");
    await deleteIdentityData(userId);

    const [bundle, verification, revocationEvent] = await Promise.all([
      db
        .select()
        .from(identityBundles)
        .where(eq(identityBundles.userId, userId))
        .get(),
      db
        .select()
        .from(identityVerifications)
        .where(eq(identityVerifications.userId, userId))
        .get(),
      db
        .select()
        .from(identityValidityEvents)
        .where(eq(identityValidityEvents.userId, userId))
        .get(),
    ]);

    expect(bundle).toBeUndefined();
    expect(verification).toBeUndefined();
    expect(revocationEvent).toBeUndefined();
  });
});
