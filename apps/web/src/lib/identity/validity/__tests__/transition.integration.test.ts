import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/connection";
import { getIdentityValiditySnapshot } from "@/lib/db/queries/identity-validity";
import {
  identityBundles,
  identityValidityEvents,
} from "@/lib/db/schema/identity";
import { recordValidityTransition } from "@/lib/identity/validity/transition";
import { createTestUser, resetDatabase } from "@/test-utils/db-test-utils";

describe("recordValidityTransition atomicity", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("leaves neither the event nor the snapshot when the snapshot write fails", async () => {
    const userId = await createTestUser();

    await expect(
      recordValidityTransition({
        userId,
        eventKind: "verified",
        source: "system",
        bundleSnapshot: {
          // References a verification that does not exist, so the snapshot
          // upsert fails after the event insert succeeded.
          effectiveVerificationId: "missing-verification",
          revokedAt: null,
          revokedBy: null,
          revokedReason: null,
          validityStatus: "verified",
        },
      })
    ).rejects.toThrow();

    const events = await db
      .select()
      .from(identityValidityEvents)
      .where(eq(identityValidityEvents.userId, userId))
      .all();
    const bundles = await db
      .select()
      .from(identityBundles)
      .where(eq(identityBundles.userId, userId))
      .all();

    expect(events).toEqual([]);
    expect(bundles).toEqual([]);
  });

  it("records the event and the snapshot together on success", async () => {
    const userId = await createTestUser();

    const result = await recordValidityTransition({
      userId,
      eventKind: "verified",
      source: "system",
      bundleSnapshot: {
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
        validityStatus: "verified",
      },
    });

    expect(result?.event.validityStatus).toBe("verified");
    expect((await getIdentityValiditySnapshot(userId))?.validityStatus).toBe(
      "verified"
    );
  });
});
