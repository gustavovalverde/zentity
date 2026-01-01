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
  beforeEach(() => {
    resetDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("upserts sessions with sessionId and normalizes email", () => {
    const session = upsertOnboardingSession({
      email: "USER@Example.COM",
      step: 2,
      documentHash: "doc-hash",
    });

    expect(session.id).toBeDefined();
    expect(session.email).toBe("user@example.com");
    expect(session.step).toBe(2);

    // Fetch by sessionId
    const fetched = getOnboardingSessionById(session.id);
    expect(fetched?.step).toBe(2);

    // Update existing session by id
    const updated = upsertOnboardingSession({
      id: session.id,
      email: "user@example.com",
      step: 3,
      livenessPassed: true,
    });
    expect(updated.step).toBe(3);
    expect(updated.livenessPassed).toBe(true);
  });

  it("deletes onboarding sessions by sessionId", () => {
    const session = upsertOnboardingSession({ email: "delete@example.com" });

    deleteOnboardingSessionById(session.id);

    expect(getOnboardingSessionById(session.id)).toBeNull();
  });

  it("deletes onboarding sessions by email (for account cleanup)", () => {
    const session1 = upsertOnboardingSession({ email: "cleanup@example.com" });
    const session2 = upsertOnboardingSession({ email: "cleanup@example.com" });
    const otherSession = upsertOnboardingSession({
      email: "other@example.com",
    });

    deleteOnboardingSessionsByEmail("cleanup@example.com");

    // Both sessions with the email should be deleted
    expect(getOnboardingSessionById(session1.id)).toBeNull();
    expect(getOnboardingSessionById(session2.id)).toBeNull();
    // Other session should remain
    expect(getOnboardingSessionById(otherSession.id)).not.toBeNull();
  });

  it("cleans up expired onboarding sessions", () => {
    const session = upsertOnboardingSession({ email: "expire@example.com" });

    vi.advanceTimersByTime(31 * 60 * 1000);

    // Session should be expired (not returned by get)
    expect(getOnboardingSessionById(session.id)).toBeNull();

    const removed = cleanupExpiredOnboardingSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});
