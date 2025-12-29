import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupExpiredOnboardingSessions,
  deleteOnboardingSession,
  getOnboardingSessionByEmail,
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

  it("upserts sessions and normalizes email", () => {
    const session = upsertOnboardingSession({
      email: "USER@Example.COM",
      step: 2,
      documentHash: "doc-hash",
    });

    expect(session.email).toBe("user@example.com");
    expect(session.step).toBe(2);

    const fetched = getOnboardingSessionByEmail("USER@Example.COM");
    expect(fetched?.step).toBe(2);

    const updated = upsertOnboardingSession({
      email: "user@example.com",
      step: 3,
      livenessPassed: true,
    });
    expect(updated.step).toBe(3);
    expect(updated.livenessPassed).toBe(true);
  });

  it("deletes onboarding sessions by email", () => {
    upsertOnboardingSession({ email: "delete@example.com" });

    deleteOnboardingSession("delete@example.com");

    expect(getOnboardingSessionByEmail("delete@example.com")).toBeNull();
  });

  it("cleans up expired onboarding sessions", () => {
    upsertOnboardingSession({ email: "expire@example.com" });

    vi.advanceTimersByTime(31 * 60 * 1000);

    expect(getOnboardingSessionByEmail("expire@example.com")).toBeNull();

    const removed = cleanupExpiredOnboardingSessions();
    expect(removed).toBeGreaterThanOrEqual(1);
  });
});
