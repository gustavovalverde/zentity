/**
 * Challenge Store for ZK Proof Replay Resistance
 *
 * Stores nonces that must be included in ZK proofs to prevent replay attacks.
 * Each nonce is tied to a circuit type and has a short TTL.
 */

import "server-only";

import { randomBytes } from "node:crypto";
import type { CircuitType } from "./noir-verifier";

export interface Challenge {
  nonce: string; // 128-bit hex string
  circuitType: CircuitType;
  userId?: string; // Optional: bind to specific user
  createdAt: number;
  expiresAt: number;
}

// 5 minute TTL for challenges
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Use globalThis to persist challenges across hot reloads in development
const globalForChallenges = globalThis as unknown as {
  challengeStore: Map<string, Challenge> | undefined;
};

const challenges =
  globalForChallenges.challengeStore ?? new Map<string, Challenge>();

if (process.env.NODE_ENV !== "production") {
  globalForChallenges.challengeStore = challenges;
}

/**
 * Remove expired challenges
 */
function cleanupExpiredChallenges(): void {
  const now = Date.now();
  for (const [nonce, challenge] of challenges.entries()) {
    if (challenge.expiresAt < now) {
      challenges.delete(nonce);
    }
  }
}

/**
 * Generate a cryptographically secure 128-bit nonce
 */
function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Create a new challenge for proof generation
 *
 * @param circuitType - The type of circuit this challenge is for
 * @param userId - Optional user ID to bind the challenge to
 * @returns The created challenge
 */
export function createChallenge(
  circuitType: CircuitType,
  userId?: string,
): Challenge {
  cleanupExpiredChallenges();

  const now = Date.now();
  const nonce = generateNonce();

  const challenge: Challenge = {
    nonce,
    circuitType,
    userId,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  };

  challenges.set(nonce, challenge);
  return challenge;
}

/**
 * Validate and consume a challenge nonce
 *
 * @param nonce - The nonce from the proof's public inputs
 * @param circuitType - The expected circuit type
 * @param userId - Optional user ID to validate binding
 * @returns The challenge if valid, null otherwise
 *
 * IMPORTANT: This function consumes the challenge (one-time use)
 */
export function consumeChallenge(
  nonce: string,
  circuitType: CircuitType,
  userId?: string,
): Challenge | null {
  cleanupExpiredChallenges();

  const challenge = challenges.get(nonce);

  if (!challenge) {
    return null; // Unknown or already consumed
  }

  // Validate circuit type matches
  if (challenge.circuitType !== circuitType) {
    return null;
  }

  // Validate user binding if specified in challenge
  if (challenge.userId && challenge.userId !== userId) {
    return null;
  }

  // Check expiration
  if (challenge.expiresAt < Date.now()) {
    challenges.delete(nonce);
    return null;
  }

  // Consume the challenge (one-time use)
  challenges.delete(nonce);
  return challenge;
}

/**
 * Get a challenge without consuming it (for debugging/inspection)
 */
export function getChallenge(nonce: string): Challenge | null {
  cleanupExpiredChallenges();
  return challenges.get(nonce) ?? null;
}

/**
 * Get count of active challenges (for monitoring)
 */
export function getActiveChallengeCount(): number {
  cleanupExpiredChallenges();
  return challenges.size;
}
