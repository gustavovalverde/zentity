/**
 * Database utilities for Zentity
 *
 * This module provides database access for identity proofs and verification data.
 * Uses the same better-sqlite3 instance as Better Auth.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { EncryptJWT, jwtDecrypt } from "jose";

// Use DATABASE_PATH env var for Docker volume persistence, default to ./dev.db for local dev
const dbPath = process.env.DATABASE_PATH || "./dev.db";

// Ensure the database directory exists
const dbDir = path.dirname(dbPath);
if (dbDir !== "." && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

/**
 * Initialize the identity_proofs table.
 *
 * This table stores privacy-preserving identity verification data:
 * - Cryptographic commitments (hashes) - not reversible
 * - FHE-encrypted data - can only be computed on, not read
 * - ZK proofs - cryptographic proofs of claims
 * - Boolean verification flags - results of verification steps
 *
 * NO RAW PII IS STORED.
 */
export function initializeIdentityProofsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS identity_proofs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,

      -- Cryptographic commitments (non-reversible hashes)
      document_hash TEXT NOT NULL,        -- SHA256(doc_number + user_salt)
      name_commitment TEXT NOT NULL,      -- SHA256(full_name + user_salt)

      -- User's salt for commitments (stored encrypted, enables GDPR erasure)
      user_salt TEXT NOT NULL,

      -- FHE encrypted data (can only be computed on, not decrypted by us)
      dob_ciphertext TEXT,                -- FHE encrypted birth year
      fhe_client_key_id TEXT,             -- Reference to user's FHE key

      -- ZK Proofs (cryptographic proofs of claims)
      age_proof TEXT,                     -- JSON: ZK proof that age >= 18
      age_proof_verified INTEGER DEFAULT 0,

      -- Document information (non-PII)
      document_type TEXT,                 -- 'cedula', 'passport', 'drivers_license'
      country_verified TEXT,              -- Country code: 'DOM', 'USA', etc.

      -- Verification flags (boolean results)
      is_document_verified INTEGER DEFAULT 0,
      is_liveness_passed INTEGER DEFAULT 0,
      is_face_matched INTEGER DEFAULT 0,

      -- Verification metadata
      verification_method TEXT,           -- 'ocr_local', 'ocr_cloud', 'manual'
      verified_at TEXT,                   -- ISO timestamp when verified
      confidence_score REAL,              -- Overall confidence (0.0-1.0)

      -- Timestamps
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),

      -- Sprint 1: Document validity and nationality
      doc_validity_proof TEXT,            -- ZK proof that document is not expired
      nationality_commitment TEXT,        -- SHA256(nationality_code + user_salt)
      age_proofs_json TEXT,               -- JSON: {"18": proof, "21": proof, "25": proof}

      -- Sprint 2: FHE expansion
      gender_ciphertext TEXT,             -- FHE encrypted gender (ISO 5218)
      dob_full_ciphertext TEXT,           -- FHE encrypted full DOB as YYYYMMDD (u32)

      -- Sprint 3: Advanced ZK + Liveness FHE
      nationality_membership_proof TEXT,  -- ZK proof of nationality group membership
      liveness_score_ciphertext TEXT,     -- FHE encrypted liveness score (0.0-1.0 as u16)

      -- User display data (JWE encrypted, reversible for user display)
      first_name_encrypted TEXT           -- JWE encrypted first name for dashboard display
    );

    -- Unique constraint: one identity proof per user
    CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_proofs_user_id
      ON identity_proofs (user_id);

    -- Index for duplicate document detection
    CREATE INDEX IF NOT EXISTS idx_identity_proofs_document_hash
      ON identity_proofs (document_hash);
  `);

  // Migration: Add missing columns to existing tables
  // SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, so we use try/catch
  const columnsToAdd = [
    { name: "doc_validity_proof", type: "TEXT" },
    { name: "nationality_commitment", type: "TEXT" },
    { name: "age_proofs_json", type: "TEXT" },
    { name: "gender_ciphertext", type: "TEXT" },
    { name: "dob_full_ciphertext", type: "TEXT" },
    { name: "nationality_membership_proof", type: "TEXT" },
    { name: "liveness_score_ciphertext", type: "TEXT" },
    { name: "first_name_encrypted", type: "TEXT" },
  ];

  for (const col of columnsToAdd) {
    try {
      db.exec(`ALTER TABLE identity_proofs ADD COLUMN ${col.name} ${col.type}`);
    } catch {
      // Column already exists, ignore
    }
  }
}

/**
 * Identity proof data structure
 */
export interface IdentityProof {
  id: string;
  userId: string;

  // Commitments
  documentHash: string;
  nameCommitment: string;
  userSalt: string;

  // FHE data
  dobCiphertext?: string;
  fheClientKeyId?: string;

  // ZK Proofs
  ageProof?: string;
  ageProofVerified: boolean;

  // Document info
  documentType?: string;
  countryVerified?: string;

  // Verification flags
  isDocumentVerified: boolean;
  isLivenessPassed: boolean;
  isFaceMatched: boolean;

  // Metadata
  verificationMethod?: string;
  verifiedAt?: string;
  confidenceScore?: number;
  createdAt: string;
  updatedAt: string;

  // Sprint 1 additions
  docValidityProof?: string; // ZK proof that document is not expired
  nationalityCommitment?: string; // SHA256(nationality_code + user_salt)
  ageProofsJson?: string; // JSON: {"18": proof, "21": proof, "25": proof}

  // Sprint 2 additions: FHE expansion
  genderCiphertext?: string; // FHE encrypted gender (ISO 5218)
  dobFullCiphertext?: string; // FHE encrypted full DOB as YYYYMMDD (u32)

  // Sprint 3 additions: Advanced ZK + Liveness FHE
  nationalityMembershipProof?: string; // ZK proof of nationality group membership
  livenessScoreCiphertext?: string; // FHE encrypted liveness score (0.0-1.0 as u16)

  // User display data (JWE encrypted, reversible)
  firstNameEncrypted?: string; // JWE encrypted first name for dashboard display
}

/**
 * Create a new identity proof record
 */
export function createIdentityProof(
  proof: Omit<IdentityProof, "createdAt" | "updatedAt">,
): void {
  const stmt = db.prepare(`
    INSERT INTO identity_proofs (
      id, user_id, document_hash, name_commitment, user_salt,
      dob_ciphertext, fhe_client_key_id, age_proof, age_proof_verified,
      document_type, country_verified, is_document_verified,
      is_liveness_passed, is_face_matched, verification_method,
      verified_at, confidence_score,
      doc_validity_proof, nationality_commitment, age_proofs_json,
      gender_ciphertext, dob_full_ciphertext,
      nationality_membership_proof, liveness_score_ciphertext,
      first_name_encrypted
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?
    )
  `);

  stmt.run(
    proof.id,
    proof.userId,
    proof.documentHash,
    proof.nameCommitment,
    proof.userSalt,
    proof.dobCiphertext || null,
    proof.fheClientKeyId || null,
    proof.ageProof || null,
    proof.ageProofVerified ? 1 : 0,
    proof.documentType || null,
    proof.countryVerified || null,
    proof.isDocumentVerified ? 1 : 0,
    proof.isLivenessPassed ? 1 : 0,
    proof.isFaceMatched ? 1 : 0,
    proof.verificationMethod || null,
    proof.verifiedAt || null,
    proof.confidenceScore || null,
    proof.docValidityProof || null,
    proof.nationalityCommitment || null,
    proof.ageProofsJson || null,
    proof.genderCiphertext || null,
    proof.dobFullCiphertext || null,
    proof.nationalityMembershipProof || null,
    proof.livenessScoreCiphertext || null,
    proof.firstNameEncrypted || null,
  );
}

/**
 * Get identity proof by user ID
 */
export function getIdentityProofByUserId(userId: string): IdentityProof | null {
  const stmt = db.prepare(`
    SELECT
      id, user_id as userId, document_hash as documentHash,
      name_commitment as nameCommitment, user_salt as userSalt,
      dob_ciphertext as dobCiphertext, fhe_client_key_id as fheClientKeyId,
      age_proof as ageProof, age_proof_verified as ageProofVerified,
      document_type as documentType, country_verified as countryVerified,
      is_document_verified as isDocumentVerified,
      is_liveness_passed as isLivenessPassed, is_face_matched as isFaceMatched,
      verification_method as verificationMethod, verified_at as verifiedAt,
      confidence_score as confidenceScore, created_at as createdAt,
      updated_at as updatedAt,
      doc_validity_proof as docValidityProof,
      nationality_commitment as nationalityCommitment,
      age_proofs_json as ageProofsJson,
      gender_ciphertext as genderCiphertext,
      dob_full_ciphertext as dobFullCiphertext,
      nationality_membership_proof as nationalityMembershipProof,
      liveness_score_ciphertext as livenessScoreCiphertext,
      first_name_encrypted as firstNameEncrypted
    FROM identity_proofs
    WHERE user_id = ?
  `);

  const row = stmt.get(userId) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    ...row,
    ageProofVerified: Boolean(row.ageProofVerified),
    isDocumentVerified: Boolean(row.isDocumentVerified),
    isLivenessPassed: Boolean(row.isLivenessPassed),
    isFaceMatched: Boolean(row.isFaceMatched),
  } as IdentityProof;
}

/**
 * Update identity proof verification flags
 */
export function updateIdentityProofFlags(
  userId: string,
  flags: {
    isDocumentVerified?: boolean;
    isLivenessPassed?: boolean;
    isFaceMatched?: boolean;
    ageProofVerified?: boolean;
    verifiedAt?: string;
    dobCiphertext?: string;
    fheClientKeyId?: string;
    ageProof?: string;
    // Sprint 1 additions
    docValidityProof?: string;
    nationalityCommitment?: string;
    ageProofsJson?: string;
    // Sprint 2 additions
    genderCiphertext?: string;
    dobFullCiphertext?: string;
    // Sprint 3 additions
    nationalityMembershipProof?: string;
    livenessScoreCiphertext?: string;
    // User display data
    firstNameEncrypted?: string;
  },
): void {
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (flags.isDocumentVerified !== undefined) {
    updates.push("is_document_verified = ?");
    values.push(flags.isDocumentVerified ? 1 : 0);
  }
  if (flags.isLivenessPassed !== undefined) {
    updates.push("is_liveness_passed = ?");
    values.push(flags.isLivenessPassed ? 1 : 0);
  }
  if (flags.isFaceMatched !== undefined) {
    updates.push("is_face_matched = ?");
    values.push(flags.isFaceMatched ? 1 : 0);
  }
  if (flags.ageProofVerified !== undefined) {
    updates.push("age_proof_verified = ?");
    values.push(flags.ageProofVerified ? 1 : 0);
  }
  if (flags.verifiedAt !== undefined) {
    updates.push("verified_at = ?");
    values.push(flags.verifiedAt);
  }
  if (flags.dobCiphertext !== undefined) {
    updates.push("dob_ciphertext = ?");
    values.push(flags.dobCiphertext);
  }
  if (flags.fheClientKeyId !== undefined) {
    updates.push("fhe_client_key_id = ?");
    values.push(flags.fheClientKeyId);
  }
  if (flags.ageProof !== undefined) {
    updates.push("age_proof = ?");
    values.push(flags.ageProof);
  }
  // Sprint 1 additions
  if (flags.docValidityProof !== undefined) {
    updates.push("doc_validity_proof = ?");
    values.push(flags.docValidityProof);
  }
  if (flags.nationalityCommitment !== undefined) {
    updates.push("nationality_commitment = ?");
    values.push(flags.nationalityCommitment);
  }
  if (flags.ageProofsJson !== undefined) {
    updates.push("age_proofs_json = ?");
    values.push(flags.ageProofsJson);
  }
  // Sprint 2 additions
  if (flags.genderCiphertext !== undefined) {
    updates.push("gender_ciphertext = ?");
    values.push(flags.genderCiphertext);
  }
  if (flags.dobFullCiphertext !== undefined) {
    updates.push("dob_full_ciphertext = ?");
    values.push(flags.dobFullCiphertext);
  }
  // Sprint 3 additions
  if (flags.nationalityMembershipProof !== undefined) {
    updates.push("nationality_membership_proof = ?");
    values.push(flags.nationalityMembershipProof);
  }
  if (flags.livenessScoreCiphertext !== undefined) {
    updates.push("liveness_score_ciphertext = ?");
    values.push(flags.livenessScoreCiphertext);
  }
  // User display data
  if (flags.firstNameEncrypted !== undefined) {
    updates.push("first_name_encrypted = ?");
    values.push(flags.firstNameEncrypted);
  }

  updates.push("updated_at = datetime('now')");
  values.push(userId);

  const stmt = db.prepare(`
    UPDATE identity_proofs
    SET ${updates.join(", ")}
    WHERE user_id = ?
  `);

  stmt.run(...values);
}

/**
 * Check if a document hash already exists (prevent duplicate signups)
 */
export function documentHashExists(documentHash: string): boolean {
  const stmt = db.prepare(`
    SELECT 1 FROM identity_proofs WHERE document_hash = ?
  `);
  return stmt.get(documentHash) !== undefined;
}

/**
 * Verify a name claim against stored commitment
 */
export function verifyNameClaimForUser(
  userId: string,
  claimedNameHash: string,
): boolean {
  const stmt = db.prepare(`
    SELECT name_commitment FROM identity_proofs WHERE user_id = ?
  `);
  const row = stmt.get(userId) as { name_commitment: string } | undefined;

  if (!row) return false;
  return row.name_commitment === claimedNameHash;
}

/**
 * Delete user's identity proof (GDPR right to erasure)
 *
 * This effectively "forgets" the user's identity by removing their salt,
 * making all commitments unlinkable.
 */
export function deleteIdentityProof(userId: string): void {
  const stmt = db.prepare(`
    DELETE FROM identity_proofs WHERE user_id = ?
  `);
  stmt.run(userId);
}

/**
 * Get verification status for a user (public API response)
 */
export function getVerificationStatus(userId: string): {
  verified: boolean;
  level: "none" | "basic" | "full";
  checks: {
    document: boolean;
    liveness: boolean;
    faceMatch: boolean;
    ageProof: boolean;
  };
} {
  const proof = getIdentityProofByUserId(userId);

  if (!proof) {
    return {
      verified: false,
      level: "none",
      checks: {
        document: false,
        liveness: false,
        faceMatch: false,
        ageProof: false,
      },
    };
  }

  const checks = {
    document: proof.isDocumentVerified,
    liveness: proof.isLivenessPassed,
    faceMatch: proof.isFaceMatched,
    ageProof: proof.ageProofVerified,
  };

  const passedChecks = Object.values(checks).filter(Boolean).length;

  let level: "none" | "basic" | "full" = "none";
  if (passedChecks >= 4) {
    level = "full";
  } else if (passedChecks >= 2) {
    level = "basic";
  }

  return {
    verified: level === "full",
    level,
    checks,
  };
}

/**
 * Update user's display name in Better Auth user table
 *
 * This is called after successful identity verification to set the user's
 * display name based on their verified document.
 *
 * Note: This updates the display name only - the actual full name is
 * NOT stored (only cryptographic commitment is persisted).
 */
export function updateUserName(userId: string, displayName: string): void {
  const stmt = db.prepare(`
    UPDATE "user"
    SET name = ?, "updatedAt" = datetime('now')
    WHERE id = ?
  `);
  stmt.run(displayName, userId);
}

/**
 * Get user's current display name
 */
export function getUserName(userId: string): string | null {
  const stmt = db.prepare(`SELECT name FROM "user" WHERE id = ?`);
  const row = stmt.get(userId) as { name: string } | undefined;
  return row?.name || null;
}

/**
 * Age proof data structure (from age_proofs table)
 */
export interface AgeProof {
  proofId: string;
  isOver18: boolean;
  generationTimeMs: number;
  createdAt: string;
  hasFheEncryption: boolean;
  fheEncryptionTimeMs: number | null;
  dobCiphertext: string | null;
}

/**
 * Get user's age proof (ZK proof from onboarding)
 */
export function getUserAgeProof(userId: string): AgeProof | null {
  try {
    const stmt = db.prepare(`
      SELECT id, is_over_18, generation_time_ms, created_at, dob_ciphertext, fhe_encryption_time_ms
      FROM age_proofs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const proof = stmt.get(userId) as
      | {
          id: string;
          is_over_18: number;
          generation_time_ms: number;
          created_at: string;
          dob_ciphertext: string | null;
          fhe_encryption_time_ms: number | null;
        }
      | undefined;

    if (!proof) return null;

    return {
      proofId: proof.id,
      isOver18: Boolean(proof.is_over_18),
      generationTimeMs: proof.generation_time_ms,
      createdAt: proof.created_at,
      hasFheEncryption: !!proof.dob_ciphertext,
      fheEncryptionTimeMs: proof.fhe_encryption_time_ms,
      dobCiphertext: proof.dob_ciphertext,
    };
  } catch {
    return null;
  }
}

// Initialize table on module load
initializeIdentityProofsTable();

// ============================================================================
// First Name Encryption Utilities
// ============================================================================

/**
 * Get encryption secret from environment
 * Uses the same secret as Better Auth for consistency
 *
 * AES-256-GCM requires exactly 256 bits (32 bytes).
 * We derive a fixed-length key from the secret using SHA-256.
 */
async function getEncryptionSecret(): Promise<Uint8Array> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET environment variable is required");
  }

  // Derive a 256-bit key from the secret using SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

/**
 * Encrypt first name using JWE (AES-256-GCM)
 *
 * This allows us to store the first name reversibly (unlike SHA256 commitments)
 * so we can display it back to the user on their dashboard.
 *
 * Security: Same encryption used for session cookies (JWE with AES-256-GCM)
 */
export async function encryptFirstName(firstName: string): Promise<string> {
  const secret = await getEncryptionSecret();

  const token = await new EncryptJWT({ firstName })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(secret);

  return token;
}

/**
 * Decrypt first name from JWE token
 *
 * @returns The decrypted first name, or null if decryption fails
 */
export async function decryptFirstName(
  encryptedToken: string,
): Promise<string | null> {
  try {
    const secret = await getEncryptionSecret();
    const { payload } = await jwtDecrypt(encryptedToken, secret);
    return (payload.firstName as string) || null;
  } catch {
    // Token invalid or corrupted
    return null;
  }
}

/**
 * Get user's decrypted first name for display
 *
 * Fetches the identity proof and decrypts the stored first name.
 * Returns null if no proof exists or decryption fails.
 */
export async function getUserFirstName(userId: string): Promise<string | null> {
  const proof = getIdentityProofByUserId(userId);
  if (!proof?.firstNameEncrypted) return null;

  return decryptFirstName(proof.firstNameEncrypted);
}

/**
 * Initialize the onboarding_sessions table.
 *
 * This table stores temporary session data during the signup wizard.
 * Sensitive PII is encrypted at rest using AES-256-GCM.
 * Sessions auto-expire after 30 minutes of inactivity.
 *
 * Privacy considerations:
 * - PII is encrypted before storage
 * - Sessions are deleted after successful signup
 * - Expired sessions are automatically cleaned up
 */
export function initializeOnboardingSessionsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboarding_sessions (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      step INTEGER DEFAULT 1,

      -- Encrypted PII (AES-256-GCM via jose JWE)
      -- Contains: extractedName, extractedDOB, extractedDocNumber, extractedNationality
      encrypted_pii TEXT,

      -- Document processing state (references, not raw data)
      document_hash TEXT,           -- SHA256 of uploaded document (for dedup)
      document_processed INTEGER DEFAULT 0,

      -- Selfie/liveness state
      liveness_passed INTEGER DEFAULT 0,
      face_match_passed INTEGER DEFAULT 0,

      -- Timestamps
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      expires_at INTEGER            -- Unix timestamp for auto-expiration
    );

    -- Index for cleanup job
    CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_expires_at
      ON onboarding_sessions (expires_at);
  `);
}

/**
 * Onboarding session data structure
 */
export interface OnboardingSession {
  id: string;
  email: string;
  step: number;
  encryptedPii: string | null;
  documentHash: string | null;
  documentProcessed: boolean;
  livenessPassed: boolean;
  faceMatchPassed: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

const ONBOARDING_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create or update an onboarding session
 */
export function upsertOnboardingSession(
  data: Partial<OnboardingSession> & { email: string },
): OnboardingSession {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.floor(ONBOARDING_SESSION_TTL_MS / 1000);

  // Check if session exists
  const existing = getOnboardingSessionByEmail(data.email);

  if (existing) {
    // Update existing session
    const updates: string[] = ["updated_at = ?", "expires_at = ?"];
    const values: (string | number | null)[] = [now, expiresAt];

    if (data.step !== undefined) {
      updates.push("step = ?");
      values.push(data.step);
    }
    if (data.encryptedPii !== undefined) {
      updates.push("encrypted_pii = ?");
      values.push(data.encryptedPii);
    }
    if (data.documentHash !== undefined) {
      updates.push("document_hash = ?");
      values.push(data.documentHash);
    }
    if (data.documentProcessed !== undefined) {
      updates.push("document_processed = ?");
      values.push(data.documentProcessed ? 1 : 0);
    }
    if (data.livenessPassed !== undefined) {
      updates.push("liveness_passed = ?");
      values.push(data.livenessPassed ? 1 : 0);
    }
    if (data.faceMatchPassed !== undefined) {
      updates.push("face_match_passed = ?");
      values.push(data.faceMatchPassed ? 1 : 0);
    }

    values.push(data.email);

    const stmt = db.prepare(`
      UPDATE onboarding_sessions
      SET ${updates.join(", ")}
      WHERE email = ?
    `);
    stmt.run(...values);

    return getOnboardingSessionByEmail(data.email)!;
  }

  // Create new session
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO onboarding_sessions (
      id, email, step, encrypted_pii, document_hash,
      document_processed, liveness_passed, face_match_passed,
      created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    data.email,
    data.step ?? 1,
    data.encryptedPii ?? null,
    data.documentHash ?? null,
    data.documentProcessed ? 1 : 0,
    data.livenessPassed ? 1 : 0,
    data.faceMatchPassed ? 1 : 0,
    now,
    now,
    expiresAt,
  );

  return getOnboardingSessionByEmail(data.email)!;
}

/**
 * Get onboarding session by email
 */
export function getOnboardingSessionByEmail(
  email: string,
): OnboardingSession | null {
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    SELECT
      id, email, step, encrypted_pii as encryptedPii,
      document_hash as documentHash, document_processed as documentProcessed,
      liveness_passed as livenessPassed, face_match_passed as faceMatchPassed,
      created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt
    FROM onboarding_sessions
    WHERE email = ? AND expires_at > ?
  `);

  const row = stmt.get(email, now) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    ...row,
    documentProcessed: Boolean(row.documentProcessed),
    livenessPassed: Boolean(row.livenessPassed),
    faceMatchPassed: Boolean(row.faceMatchPassed),
  } as OnboardingSession;
}

/**
 * Delete onboarding session (called after successful signup)
 */
export function deleteOnboardingSession(email: string): void {
  const stmt = db.prepare(`DELETE FROM onboarding_sessions WHERE email = ?`);
  stmt.run(email);
}

/**
 * Clean up expired onboarding sessions
 * Should be called periodically (e.g., via cron or on each request)
 */
export function cleanupExpiredOnboardingSessions(): number {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    DELETE FROM onboarding_sessions WHERE expires_at < ?
  `);
  const result = stmt.run(now);
  return result.changes;
}

// Initialize onboarding sessions table
initializeOnboardingSessionsTable();

export default db;
