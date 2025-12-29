import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeRpAuthorizationCode,
  createRpAuthorizationCode,
} from "@/lib/db/queries/rp";
import { createTestUser, resetDatabase } from "@/test/db-test-utils";

describe("rp authorization code queries", () => {
  beforeEach(() => {
    resetDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and consumes authorization codes", () => {
    const userId = createTestUser();
    const { code, expiresAt } = createRpAuthorizationCode({
      clientId: "client-1",
      redirectUri: "https://example.com/callback",
      state: "state-1",
      userId,
    });

    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(expiresAt).toBe(nowSeconds + 5 * 60);

    const consumed = consumeRpAuthorizationCode(code);
    expect(consumed?.code).toBe(code);
    expect(consumed?.usedAt).toBe(nowSeconds);

    const secondConsume = consumeRpAuthorizationCode(code);
    expect(secondConsume).toBeNull();
  });

  it("rejects expired authorization codes", () => {
    const userId = createTestUser();
    const { code } = createRpAuthorizationCode({
      clientId: "client-2",
      redirectUri: "https://example.com/callback",
      userId,
    });

    vi.advanceTimersByTime(6 * 60 * 1000);

    const consumed = consumeRpAuthorizationCode(code);
    expect(consumed).toBeNull();
  });
});
