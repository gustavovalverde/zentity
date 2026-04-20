import crypto from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  createVerification,
  reconcileIdentityBundle,
} from "@/lib/db/queries/identity";
import { getValidityReadModel } from "@/lib/identity/validity/read-model";
import { applyValidityTransition } from "@/lib/identity/validity/transition";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

describe("validity read model", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records a verified validity event against the current verified snapshot", async () => {
    const userId = await createTestUser();
    const verificationId = crypto.randomUUID();

    await createVerification({
      id: verificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-validity-verified",
      verifiedAt: "2026-04-20T12:00:00Z",
    });
    await reconcileIdentityBundle(userId);
    await applyValidityTransition({
      userId,
      verificationId,
      eventKind: "verified",
      source: "system",
      occurredAt: "2026-04-20T12:00:01Z",
    });

    const model = await getValidityReadModel(userId);

    expect(model.snapshot?.validityStatus).toBe("verified");
    expect(model.latestEvent).toEqual(
      expect.objectContaining({
        verificationId,
        eventKind: "verified",
        validityStatus: "verified",
        source: "system",
      })
    );
    expect(model.latestEventDeliveries).toEqual([]);
    expect(model.deliverySummary).toEqual({
      pending: 0,
      delivered: 0,
      retrying: 0,
      dead_letter: 0,
    });
  });

  it("keeps the snapshot verified when a later verification fails", async () => {
    const userId = await createTestUser();
    const verifiedVerificationId = crypto.randomUUID();
    const failedVerificationId = crypto.randomUUID();

    await createVerification({
      id: verifiedVerificationId,
      userId,
      method: "ocr",
      status: "verified",
      dedupKey: "dedup-validity-primary",
      verifiedAt: "2026-04-20T12:00:00Z",
    });
    await reconcileIdentityBundle(userId);

    await createVerification({
      id: failedVerificationId,
      userId,
      method: "ocr",
      status: "failed",
      documentHash: "hash-failed-secondary",
    });
    await reconcileIdentityBundle(userId);
    await applyValidityTransition({
      userId,
      verificationId: failedVerificationId,
      eventKind: "failed",
      source: "system",
      occurredAt: "2026-04-20T12:05:00Z",
      reason: "ocr_confidence_too_low",
    });

    const model = await getValidityReadModel(userId);

    expect(model.snapshot?.validityStatus).toBe("verified");
    expect(model.latestEvent).toEqual(
      expect.objectContaining({
        verificationId: failedVerificationId,
        eventKind: "failed",
        validityStatus: "verified",
        reason: "ocr_confidence_too_low",
      })
    );
    expect(model.latestEventDeliveries).toEqual([]);
  });
});
