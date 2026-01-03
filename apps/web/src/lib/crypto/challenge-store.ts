/**
 * Challenge Store for ZK Proof Replay Resistance
 *
 * Stores nonces that must be included in ZK proofs to prevent replay attacks.
 * Each nonce is tied to a circuit type and has a short TTL.
 */

import "server-only";

import type { CircuitType } from "@/lib/zk/zk-circuit-spec";

import { randomBytes } from "node:crypto";

import { eq, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db/connection";
import { zkChallenges } from "@/lib/db/schema/crypto";

interface Challenge {
  nonce: string; // 128-bit hex string
  circuitType: CircuitType;
  userId?: string; // Optional: bind to specific user
  createdAt: number;
  expiresAt: number;
}

// 15 minute TTL for challenges (covers slower client-side proving on low-end devices)
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

/**
 * Remove expired challenges
 */
async function cleanupExpiredChallenges(): Promise<void> {
  const now = Date.now();
  await db.delete(zkChallenges).where(lt(zkChallenges.expiresAt, now)).run();
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
export async function createChallenge(
  circuitType: CircuitType,
  userId?: string
): Promise<Challenge> {
  await cleanupExpiredChallenges();

  const now = Date.now();
  const expiresAt = now + CHALLENGE_TTL_MS;

  // Extremely unlikely collision, but handle deterministically.
  for (let i = 0; i < 3; i++) {
    const nonce = generateNonce();
    try {
      await db
        .insert(zkChallenges)
        .values({
          nonce,
          circuitType,
          userId: userId ?? null,
          createdAt: now,
          expiresAt,
        })
        .run();

      return { nonce, circuitType, userId, createdAt: now, expiresAt };
    } catch {
      // Retry on collision
    }
  }

  throw new Error("Failed to create challenge nonce");
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
export async function consumeChallenge(
  nonce: string,
  circuitType: CircuitType,
  userId?: string
): Promise<Challenge | null> {
  await cleanupExpiredChallenges();

  return db.transaction(async (tx) => {
    const row = await tx
      .select({
        nonce: zkChallenges.nonce,
        circuitType: zkChallenges.circuitType,
        userId: zkChallenges.userId,
        createdAt: zkChallenges.createdAt,
        expiresAt: zkChallenges.expiresAt,
      })
      .from(zkChallenges)
      .where(eq(zkChallenges.nonce, nonce))
      .limit(1)
      .get();

    if (!row) {
      return null;
    }
    if (row.circuitType !== circuitType) {
      return null;
    }
    if (row.userId && row.userId !== userId) {
      return null;
    }
    if (row.expiresAt < Date.now()) {
      await tx.delete(zkChallenges).where(eq(zkChallenges.nonce, nonce)).run();
      return null;
    }

    await tx.delete(zkChallenges).where(eq(zkChallenges.nonce, nonce)).run();

    return {
      nonce: row.nonce,
      circuitType: row.circuitType as CircuitType,
      userId: row.userId ?? undefined,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  });
}

/**
 * Get a challenge without consuming it (for debugging/inspection)
 */
async function _getChallenge(nonce: string): Promise<Challenge | null> {
  await cleanupExpiredChallenges();
  const row = await db
    .select({
      nonce: zkChallenges.nonce,
      circuitType: zkChallenges.circuitType,
      userId: zkChallenges.userId,
      createdAt: zkChallenges.createdAt,
      expiresAt: zkChallenges.expiresAt,
    })
    .from(zkChallenges)
    .where(eq(zkChallenges.nonce, nonce))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }
  if (row.expiresAt < Date.now()) {
    await db.delete(zkChallenges).where(eq(zkChallenges.nonce, nonce)).run();
    return null;
  }

  return {
    nonce: row.nonce,
    circuitType: row.circuitType as CircuitType,
    userId: row.userId ?? undefined,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Get count of active challenges (for monitoring)
 */
export async function getActiveChallengeCount(): Promise<number> {
  await cleanupExpiredChallenges();
  const row = await db
    .select({ count: sql<number>`count(*)` })
    .from(zkChallenges)
    .get();
  return row?.count ?? 0;
}
