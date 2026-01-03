import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupExpiredOnboardingSessions,
  deleteOnboardingSessionById,
  deleteOnboardingSessionsByEmail,
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

  it("upserts sessions with sessionId and normalizes email", async () => {
    const session = await upsertOnboardingSession({
      email: "USER@Example.COM",
      step: 2,
      documentHash: "doc-hash",
    });

    expect(session.id).toBeDefined();
    expect(session.email).toBe("user@example.com");
    expect(session.step).toBe(2);

    // Fetch by sessionId
    const fetched = await getOnboardingSessionById(session.id);
    expect(fetched?.step).toBe(2);

    // Update existing session by id
    const updated = await upsertOnboardingSession({
      id: session.id,
      email: "user@example.com",
      step: 3,
      livenessPassed: true,
    });
    expect(updated.step).toBe(3);
    expect(updated.livenessPassed).toBe(true);
  });

  it("deletes onboarding sessions by sessionId", async () => {
    const session = await upsertOnboardingSession({
      email: "delete@example.com",
    });

    await deleteOnboardingSessionById(session.id);

    await expect(getOnboardingSessionById(session.id)).resolves.toBeNull();
  });

  it("deletes onboarding sessions by email (for account cleanup)", async () => {
    const session1 = await upsertOnboardingSession({
      email: "cleanup@example.com",
    });
    const session2 = await upsertOnboardingSession({
      email: "cleanup@example.com",
    });
    const otherSession = await upsertOnboardingSession({
      email: "other@example.com",
    });

    await deleteOnboardingSessionsByEmail("cleanup@example.com");

    // Both sessions with the email should be deleted
    await expect(getOnboardingSessionById(session1.id)).resolves.toBeNull();
    await expect(getOnboardingSessionById(session2.id)).resolves.toBeNull();
    // Other session should remain
    await expect(
      getOnboardingSessionById(otherSession.id)
    ).resolves.not.toBeNull();
  });

  it("cleans up expired onboarding sessions", async () => {
    const session = await upsertOnboardingSession({
      email: "expire@example.com",
    });

    vi.advanceTimersByTime(31 * 60 * 1000);

    // Session should be expired (not returned by get)
    await expect(getOnboardingSessionById(session.id)).resolves.toBeNull();

    const removed = await cleanupExpiredOnboardingSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});
