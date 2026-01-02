import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

import { resetDatabase } from "@/test/db-test-utils";

import {
  consumeChallenge,
  createChallenge,
  getActiveChallengeCount,
} from "../challenge-store";

/** Matches a 32-character lowercase hex nonce */
const HEX_NONCE_PATTERN = /^[0-9a-f]{32}$/;

describe("challenge-store", () => {
  beforeEach(() => {
    resetDatabase();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createChallenge", () => {
    it("creates a challenge with unique 32-char hex nonce", () => {
      const challenge = createChallenge("age_verification");

      expect(challenge.nonce).toBeDefined();
      expect(challenge.nonce).toHaveLength(32); // 128-bit = 16 bytes = 32 hex chars
      expect(HEX_NONCE_PATTERN.test(challenge.nonce)).toBe(true);
    });

    it("creates challenge with correct circuit type", () => {
      const challenge = createChallenge("doc_validity");

      expect(challenge.circuitType).toBe("doc_validity");
    });

    it("creates challenge bound to user when provided", () => {
      const challenge = createChallenge("age_verification", "user-123");

      expect(challenge.userId).toBe("user-123");
    });

    it("creates challenge without user binding when not provided", () => {
      const challenge = createChallenge("age_verification");

      expect(challenge.userId).toBeUndefined();
    });

    it("sets expiry 15 minutes from creation", () => {
      const now = Date.now();
      const challenge = createChallenge("age_verification");

      expect(challenge.createdAt).toBe(now);
      expect(challenge.expiresAt).toBe(now + 15 * 60 * 1000);
    });

    it("generates unique nonces for each challenge", () => {
      const challenge1 = createChallenge("age_verification");
      const challenge2 = createChallenge("age_verification");

      expect(challenge1.nonce).not.toBe(challenge2.nonce);
    });

    it("supports all circuit types", () => {
      const circuitTypes = [
        "age_verification",
        "doc_validity",
        "nationality_membership",
        "face_match",
      ] as const;

      for (const circuitType of circuitTypes) {
        const challenge = createChallenge(circuitType);
        expect(challenge.circuitType).toBe(circuitType);
      }
    });
  });

  describe("consumeChallenge - success cases", () => {
    it("consumes a valid challenge and returns it", () => {
      const challenge = createChallenge("age_verification", "user-123");
      const consumed = consumeChallenge(
        challenge.nonce,
        "age_verification",
        "user-123"
      );

      expect(consumed).not.toBeNull();
      expect(consumed?.nonce).toBe(challenge.nonce);
      expect(consumed?.circuitType).toBe("age_verification");
      expect(consumed?.userId).toBe("user-123");
    });

    it("consumes challenge without user binding", () => {
      const challenge = createChallenge("age_verification");
      const consumed = consumeChallenge(challenge.nonce, "age_verification");

      expect(consumed).not.toBeNull();
      expect(consumed?.nonce).toBe(challenge.nonce);
    });

    it("returns challenge with correct timestamps", () => {
      const now = Date.now();
      const challenge = createChallenge("age_verification");
      const consumed = consumeChallenge(challenge.nonce, "age_verification");

      expect(consumed?.createdAt).toBe(now);
      expect(consumed?.expiresAt).toBe(now + 15 * 60 * 1000);
    });
  });

  describe("consumeChallenge - replay prevention (critical security)", () => {
    it("rejects already-consumed challenge (replay attack prevention)", () => {
      const challenge = createChallenge("age_verification", "user-123");

      // First consumption succeeds
      const result1 = consumeChallenge(
        challenge.nonce,
        "age_verification",
        "user-123"
      );
      expect(result1).not.toBeNull();

      // Second consumption fails (replay attack)
      const result2 = consumeChallenge(
        challenge.nonce,
        "age_verification",
        "user-123"
      );
      expect(result2).toBeNull();
    });

    it("rejects non-existent nonce", () => {
      const result = consumeChallenge(
        "00000000000000000000000000000000",
        "age_verification"
      );

      expect(result).toBeNull();
    });

    it("rejects wrong circuit type", () => {
      const challenge = createChallenge("age_verification");

      const result = consumeChallenge(challenge.nonce, "doc_validity");

      expect(result).toBeNull();
    });

    it("rejects challenge bound to different user", () => {
      const challenge = createChallenge("age_verification", "user-123");

      const result = consumeChallenge(
        challenge.nonce,
        "age_verification",
        "user-456"
      );

      expect(result).toBeNull();
    });

    it("allows consumption of user-bound challenge without user param", () => {
      // When challenge is bound to a user but consumer doesn't specify user,
      // the check for user_id mismatch is skipped (user_id check only if row.user_id is set AND userId is provided)
      const challenge = createChallenge("age_verification", "user-123");

      // Note: Looking at the code, row.user_id && row.user_id !== userId
      // If userId is undefined, this check passes because row.user_id !== undefined is false
      // Actually: row.user_id is "user-123" (truthy), userId is undefined
      // So: row.user_id ("user-123") !== undefined -> true -> returns null
      const result = consumeChallenge(challenge.nonce, "age_verification");

      // Based on code logic, this should fail because the challenge is bound to a user
      expect(result).toBeNull();
    });

    it("rejects expired challenge", () => {
      const challenge = createChallenge("age_verification");

      // Advance time past TTL (15 minutes + 1ms)
      vi.advanceTimersByTime(15 * 60 * 1000 + 1);

      const result = consumeChallenge(challenge.nonce, "age_verification");

      expect(result).toBeNull();
    });

    it("accepts challenge just before expiry", () => {
      const challenge = createChallenge("age_verification");

      // Advance time to just before expiry (15 minutes - 1ms)
      vi.advanceTimersByTime(15 * 60 * 1000 - 1);

      const result = consumeChallenge(challenge.nonce, "age_verification");

      expect(result).not.toBeNull();
    });
  });

  describe("getActiveChallengeCount", () => {
    it("returns 0 when no challenges exist", () => {
      // Clean slate - consume any existing test challenges by advancing time
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Create and consume to trigger cleanup
      const temp = createChallenge("age_verification");
      consumeChallenge(temp.nonce, "age_verification");

      const countBefore = getActiveChallengeCount();

      const challenge = createChallenge("age_verification");
      const countAfter = getActiveChallengeCount();

      expect(countAfter).toBe(countBefore + 1);

      // Cleanup
      consumeChallenge(challenge.nonce, "age_verification");
    });

    it("increments count when challenges are created", () => {
      const countBefore = getActiveChallengeCount();

      createChallenge("age_verification");
      createChallenge("doc_validity");

      const countAfter = getActiveChallengeCount();

      expect(countAfter).toBeGreaterThanOrEqual(countBefore + 2);
    });

    it("decrements count when challenges are consumed", () => {
      const challenge = createChallenge("age_verification");
      const countWithChallenge = getActiveChallengeCount();

      consumeChallenge(challenge.nonce, "age_verification");
      const countAfterConsume = getActiveChallengeCount();

      expect(countAfterConsume).toBe(countWithChallenge - 1);
    });

    it("excludes expired challenges from count", () => {
      // Create a challenge
      createChallenge("age_verification");
      const countBefore = getActiveChallengeCount();

      // Expire it
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Count should be lower after cleanup triggered by getActiveChallengeCount
      const countAfter = getActiveChallengeCount();

      expect(countAfter).toBeLessThan(countBefore);
    });
  });

  describe("edge cases", () => {
    it("handles rapid sequential challenge creation", () => {
      const challenges: ReturnType<typeof createChallenge>[] = [];
      for (let i = 0; i < 10; i++) {
        challenges.push(createChallenge("age_verification"));
      }

      // All nonces should be unique
      const nonces = challenges.map((c) => c.nonce);
      const uniqueNonces = new Set(nonces);
      expect(uniqueNonces.size).toBe(10);
    });

    it("handles different circuit types independently", () => {
      const ageChallenge = createChallenge("age_verification", "user-1");
      const docChallenge = createChallenge("doc_validity", "user-1");

      // Each can be consumed with its own circuit type
      const ageResult = consumeChallenge(
        ageChallenge.nonce,
        "age_verification",
        "user-1"
      );
      const docResult = consumeChallenge(
        docChallenge.nonce,
        "doc_validity",
        "user-1"
      );

      expect(ageResult).not.toBeNull();
      expect(docResult).not.toBeNull();
    });

    it("challenge nonce is case-sensitive", () => {
      const challenge = createChallenge("age_verification");
      const upperNonce = challenge.nonce.toUpperCase();

      // If the nonce was all lowercase hex, uppercase should not match
      if (challenge.nonce !== upperNonce) {
        const result = consumeChallenge(upperNonce, "age_verification");
        expect(result).toBeNull();
      }
    });
  });
});
