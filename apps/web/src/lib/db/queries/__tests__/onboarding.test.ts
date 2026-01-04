import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupExpiredOnboardingSessions,
  deleteOnboardingSessionById,
  getOnboardingSessionById,
  upsertOnboardingSession,
} from "@/lib/db/queries/onboarding";
import { resetDatabase } from "@/test/db-test-utils";

describe("onboarding queries", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("upserts sessions with sessionId", async () => {
    const session = await upsertOnboardingSession({
      step: 2,
      documentHash: "doc-hash",
    });

    expect(session.id).toBeDefined();
    expect(session.step).toBe(2);

    // Fetch by sessionId
    const fetched = await getOnboardingSessionById(session.id);
    expect(fetched?.step).toBe(2);

    // Update existing session by id
    const updated = await upsertOnboardingSession({
      id: session.id,
      step: 3,
      livenessPassed: true,
    });
    expect(updated.step).toBe(3);
    expect(updated.livenessPassed).toBe(true);
  });

  it("deletes onboarding sessions by sessionId", async () => {
    const session = await upsertOnboardingSession({
      step: 1,
    });

    await deleteOnboardingSessionById(session.id);

    await expect(getOnboardingSessionById(session.id)).resolves.toBeNull();
  });

  it("cleans up expired onboarding sessions", async () => {
    const session = await upsertOnboardingSession({
      step: 1,
    });

    vi.advanceTimersByTime(31 * 60 * 1000);

    // Session should be expired (not returned by get)
    await expect(getOnboardingSessionById(session.id)).resolves.toBeNull();

    const removed = await cleanupExpiredOnboardingSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});
