/**
 * Challenge Store for ZK Proof Replay Resistance
 *
 * Stores nonces that must be included in ZK proofs to prevent replay attacks.
 * Each nonce is tied to a circuit type and has a short TTL.
 */

import "server-only";

import { randomBytes } from "node:crypto";
import type { CircuitType } from "./noir-verifier";
import {
  getDefaultDatabasePath,
  getSqliteDb,
  isSqliteBuildTime,
} from "./sqlite";

export interface Challenge {
  nonce: string; // 128-bit hex string
  circuitType: CircuitType;
  userId?: string; // Optional: bind to specific user
  createdAt: number;
  expiresAt: number;
}

// 15 minute TTL for challenges (covers slower client-side proving on low-end devices)
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

const db = getSqliteDb(getDefaultDatabasePath());

function initializeChallengeTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS zk_challenges (
      nonce TEXT PRIMARY KEY,
      circuit_type TEXT NOT NULL,
      user_id TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_zk_challenges_expires_at
      ON zk_challenges (expires_at);
  `);
}

// Skip during `next build` to avoid SQLite lock contention across build workers.
if (!isSqliteBuildTime()) {
  initializeChallengeTable();
}

/**
 * Remove expired challenges
 */
function cleanupExpiredChallenges(): void {
  const now = Date.now();
  db.prepare("DELETE FROM zk_challenges WHERE expires_at < ?").run(now);
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
  const expiresAt = now + CHALLENGE_TTL_MS;

  const insert = db.prepare(`
    INSERT INTO zk_challenges (nonce, circuit_type, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Extremely unlikely collision, but handle deterministically.
  for (let i = 0; i < 3; i++) {
    const nonce = generateNonce();
    try {
      insert.run(nonce, circuitType, userId ?? null, now, expiresAt);
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
export function consumeChallenge(
  nonce: string,
  circuitType: CircuitType,
  userId?: string,
): Challenge | null {
  cleanupExpiredChallenges();

  const tx = db.transaction((): Challenge | null => {
    const row = db
      .prepare(
        `
          SELECT nonce, circuit_type, user_id, created_at, expires_at
          FROM zk_challenges
          WHERE nonce = ?
          LIMIT 1
        `,
      )
      .get(nonce) as
      | {
          nonce: string;
          circuit_type: string;
          user_id: string | null;
          created_at: number;
          expires_at: number;
        }
      | undefined;

    if (!row) return null;
    if (row.circuit_type !== circuitType) return null;
    if (row.user_id && row.user_id !== userId) return null;
    if (row.expires_at < Date.now()) {
      db.prepare("DELETE FROM zk_challenges WHERE nonce = ?").run(nonce);
      return null;
    }

    const result = db
      .prepare("DELETE FROM zk_challenges WHERE nonce = ?")
      .run(nonce);
    if (result.changes !== 1) return null;

    return {
      nonce: row.nonce,
      circuitType: row.circuit_type as CircuitType,
      userId: row.user_id ?? undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  });

  return tx();
}

/**
 * Get a challenge without consuming it (for debugging/inspection)
 */
export function getChallenge(nonce: string): Challenge | null {
  cleanupExpiredChallenges();
  const row = db
    .prepare(
      `
        SELECT nonce, circuit_type, user_id, created_at, expires_at
        FROM zk_challenges
        WHERE nonce = ?
        LIMIT 1
      `,
    )
    .get(nonce) as
    | {
        nonce: string;
        circuit_type: string;
        user_id: string | null;
        created_at: number;
        expires_at: number;
      }
    | undefined;

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM zk_challenges WHERE nonce = ?").run(nonce);
    return null;
  }

  return {
    nonce: row.nonce,
    circuitType: row.circuit_type as CircuitType,
    userId: row.user_id ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Get count of active challenges (for monitoring)
 */
export function getActiveChallengeCount(): number {
  cleanupExpiredChallenges();
  const row = db
    .prepare("SELECT COUNT(1) as count FROM zk_challenges")
    .get() as { count: number };
  return row.count ?? 0;
}
