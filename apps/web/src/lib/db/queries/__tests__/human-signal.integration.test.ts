import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import {
  attachHumanSignal,
  createHumanSignalChallenge,
  createVerification,
  detachHumanSignal,
  getActiveHumanSignal,
  getIdentityBundleByUserId,
  upsertIdentityBundle,
} from "@/lib/db/queries/identity";
import { humanSignalChallenges, humanSignals } from "@/lib/db/schema/identity";
import { verificationChecks } from "@/lib/db/schema/privacy";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

describe("human signal identity queries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("attaches a human signal without replacing the document nullifier seed", async () => {
    const userId = await createTestUser();
    await createVerification({
      id: "verification-a",
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "document-dedup",
      documentHash: "document-hash",
      verifiedAt: "2026-01-01T00:00:00Z",
    });
    await upsertIdentityBundle({
      userId,
      validityStatus: "verified",
      nullifierSeed: "document-nullifier-seed",
    });

    const signal = await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-a",
    });

    const [activeSignal, bundle] = await Promise.all([
      getActiveHumanSignal(userId, "world_id"),
      getIdentityBundleByUserId(userId),
    ]);

    expect(signal.id).toBe(activeSignal?.id);
    expect(activeSignal?.providerSubjectHash).toBe("subject-hash-a");
    expect(activeSignal?.providerSubjectKind).toBe("nullifier");
    expect(bundle?.hasHumanSignal).toBe(true);
    expect(bundle?.nullifierSeed).toBe("document-nullifier-seed");
  });

  it("rejects attaching one active provider subject to two accounts", async () => {
    const firstUserId = await createTestUser();
    const secondUserId = await createTestUser();
    await upsertIdentityBundle({ userId: firstUserId });
    await upsertIdentityBundle({ userId: secondUserId });

    await attachHumanSignal({
      userId: firstUserId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "same-provider-subject",
    });

    await expect(
      attachHumanSignal({
        userId: secondUserId,
        provider: "world_id",
        providerSubjectKind: "nullifier",
        providerSubjectHash: "same-provider-subject",
      })
    ).rejects.toThrow("Human signal is already attached");
  });

  it("detaches the active human signal without clearing document identity state", async () => {
    const userId = await createTestUser();
    await createVerification({
      id: "verification-a",
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "document-dedup",
      documentHash: "document-hash",
      verifiedAt: "2026-01-01T00:00:00Z",
    });
    await upsertIdentityBundle({
      userId,
      effectiveVerificationId: "verification-a",
      nullifierSeed: "document-nullifier-seed",
      validityStatus: "verified",
    });

    const attached = await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-a",
    });

    await detachHumanSignal({ userId, provider: "world_id" });

    const [activeSignal, bundle, storedSignal] = await Promise.all([
      getActiveHumanSignal(userId, "world_id"),
      getIdentityBundleByUserId(userId),
      db
        .select()
        .from(humanSignals)
        .where(eq(humanSignals.id, attached.id))
        .get(),
    ]);

    expect(activeSignal).toBeNull();
    expect(storedSignal?.revokedAt).toEqual(expect.any(String));
    expect(bundle?.hasHumanSignal).toBe(false);
    expect(bundle?.effectiveVerificationId).toBe("verification-a");
    expect(bundle?.nullifierSeed).toBe("document-nullifier-seed");
    expect(bundle?.validityStatus).toBe("verified");
  });

  it("allows re-attach after detach by creating a new active signal", async () => {
    const userId = await createTestUser();
    await upsertIdentityBundle({ userId });

    const firstSignal = await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-a",
    });

    await detachHumanSignal({ userId, provider: "world_id" });

    const secondSignal = await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-b",
    });

    const [activeSignal, bundle, storedSignals] = await Promise.all([
      getActiveHumanSignal(userId, "world_id"),
      getIdentityBundleByUserId(userId),
      db
        .select()
        .from(humanSignals)
        .where(eq(humanSignals.userId, userId))
        .all(),
    ]);

    expect(secondSignal.id).not.toBe(firstSignal.id);
    expect(activeSignal?.id).toBe(secondSignal.id);
    expect(bundle?.hasHumanSignal).toBe(true);
    expect(storedSignals).toHaveLength(2);
    expect(
      storedSignals.find((signal) => signal.id === firstSignal.id)?.revokedAt
    ).toEqual(expect.any(String));
    expect(
      storedSignals.find((signal) => signal.id === secondSignal.id)?.revokedAt
    ).toBeNull();
  });

  it("syncs sybil-resistance evidence when a human signal is attached and detached", async () => {
    const userId = await createTestUser();
    await createVerification({
      id: "verification-human-only",
      userId,
      method: "ocr",
      status: "verified",
      documentHash: "document-hash",
      verifiedAt: "2026-01-01T00:00:00Z",
    });
    await db
      .insert(verificationChecks)
      .values({
        id: "sybil-check-human-only",
        userId,
        verificationId: "verification-human-only",
        checkType: "sybil_resistant",
        passed: false,
        source: "none",
        evidenceRef: null,
      })
      .run();

    const signal = await attachHumanSignal({
      userId,
      provider: "world_id",
      providerSubjectKind: "nullifier",
      providerSubjectHash: "subject-hash-human-only",
    });

    const attachedCheck = await db
      .select()
      .from(verificationChecks)
      .where(
        and(
          eq(verificationChecks.verificationId, "verification-human-only"),
          eq(verificationChecks.checkType, "sybil_resistant")
        )
      )
      .get();
    expect(attachedCheck?.passed).toBe(true);
    expect(attachedCheck?.source).toBe("human_signal");
    expect(attachedCheck?.evidenceRef).toBe(signal.id);

    await detachHumanSignal({ userId, provider: "world_id" });

    const detachedCheck = await db
      .select()
      .from(verificationChecks)
      .where(
        and(
          eq(verificationChecks.verificationId, "verification-human-only"),
          eq(verificationChecks.checkType, "sybil_resistant")
        )
      )
      .get();
    expect(detachedCheck?.passed).toBe(false);
    expect(detachedCheck?.source).toBe("none");
    expect(detachedCheck?.evidenceRef).toBeNull();
  });

  it("cleans up expired human signal challenges before creating a new one", async () => {
    const userId = await createTestUser();
    await db
      .insert(humanSignalChallenges)
      .values({
        id: "expired-challenge",
        userId,
        provider: "world_id",
        nonce: "expired-nonce",
        expiresAt: "2025-01-01T00:00:00.000Z",
      })
      .run();

    await createHumanSignalChallenge({
      id: "fresh-challenge",
      userId,
      provider: "world_id",
      nonce: "fresh-nonce",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const [expiredChallenge, freshChallenge] = await Promise.all([
      db
        .select()
        .from(humanSignalChallenges)
        .where(eq(humanSignalChallenges.id, "expired-challenge"))
        .get(),
      db
        .select()
        .from(humanSignalChallenges)
        .where(eq(humanSignalChallenges.id, "fresh-challenge"))
        .get(),
    ]);

    expect(expiredChallenge).toBeUndefined();
    expect(freshChallenge?.nonce).toBe("fresh-nonce");
  });
});
