/**
 * Database utilities for Zentity
 *
 * This module provides database access for identity proofs and verification data.
 * Uses the same `bun:sqlite` instance as Better Auth.
 */

import { EncryptJWT, jwtDecrypt } from "jose";

import { getBetterAuthSecret } from "@/lib/utils/env";

import {
  getDefaultDatabasePath,
  getSqliteDb,
  isSqliteBuildTime,
} from "./sqlite";

const db = getSqliteDb(getDefaultDatabasePath());

const identityProofsColumnsToAdd: Array<{ name: string; type: string }> = [
  { name: "doc_validity_proof", type: "TEXT" },
  { name: "nationality_commitment", type: "TEXT" },
  { name: "gender_ciphertext", type: "TEXT" },
  { name: "dob_full_ciphertext", type: "TEXT" },
  { name: "nationality_membership_proof", type: "TEXT" },
  { name: "liveness_score_ciphertext", type: "TEXT" },
  { name: "first_name_encrypted", type: "TEXT" },
  { name: "birth_year_offset", type: "INTEGER" },
];

/**
 * Initialize the identity_proofs table.
 *
 * This table stores privacy-preserving identity verification data:
 * - Cryptographic commitments (hashes) - not reversible
 * - FHE-encrypted data - can only be computed on, not read
 * - Boolean verification flags - results of verification steps
 * - Optional reversible encrypted display data (for UX only)
 *
 * No raw ID document images or extracted attributes are stored in this table.
 */
function initializeIdentityProofsTable(): void {
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

      -- Document validity and nationality
      doc_validity_proof TEXT,            -- ZK proof that document is not expired
      nationality_commitment TEXT,        -- SHA256(nationality_code + user_salt)

      -- FHE expansion
      gender_ciphertext TEXT,             -- FHE encrypted gender (ISO 5218)
      dob_full_ciphertext TEXT,           -- FHE encrypted full DOB as YYYYMMDD (u32)

      -- Advanced ZK + liveness FHE
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

  // Schema patch: add missing columns to existing tables
  // SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, so we use try/catch
  for (const col of identityProofsColumnsToAdd) {
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
interface IdentityProof {
  id: string;
  userId: string;

  // Commitments
  documentHash: string;
  nameCommitment: string;
  userSalt: string;

  // FHE data
  dobCiphertext?: string;
  fheClientKeyId?: string;

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

  // Document validity and nationality
  docValidityProof?: string; // ZK proof that document is not expired
  nationalityCommitment?: string; // SHA256(nationality_code + user_salt)

  // FHE expansion
  genderCiphertext?: string; // FHE encrypted gender (ISO 5218)
  dobFullCiphertext?: string; // FHE encrypted full DOB as YYYYMMDD (u32)

  // Advanced ZK + liveness FHE
  nationalityMembershipProof?: string; // ZK proof of nationality group membership
  livenessScoreCiphertext?: string; // FHE encrypted liveness score (0.0-1.0 as u16)

  // User display data (JWE encrypted, reversible)
  firstNameEncrypted?: string; // JWE encrypted first name for dashboard display

  // Age data for attestation (non-PII - just birth year in compact form)
  birthYearOffset?: number; // Years since 1900 (0-255)
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
      dob_ciphertext, fhe_client_key_id,
      document_type, country_verified, is_document_verified,
      is_liveness_passed, is_face_matched, verification_method,
      verified_at, confidence_score,
      doc_validity_proof, nationality_commitment,
      gender_ciphertext, dob_full_ciphertext,
      nationality_membership_proof, liveness_score_ciphertext,
      first_name_encrypted, birth_year_offset
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?
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
    proof.genderCiphertext || null,
    proof.dobFullCiphertext || null,
    proof.nationalityMembershipProof || null,
    proof.livenessScoreCiphertext || null,
    proof.firstNameEncrypted || null,
    proof.birthYearOffset ?? null,
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
      document_type as documentType, country_verified as countryVerified,
      is_document_verified as isDocumentVerified,
      is_liveness_passed as isLivenessPassed, is_face_matched as isFaceMatched,
      verification_method as verificationMethod, verified_at as verifiedAt,
      confidence_score as confidenceScore, created_at as createdAt,
      updated_at as updatedAt,
      doc_validity_proof as docValidityProof,
      nationality_commitment as nationalityCommitment,
      gender_ciphertext as genderCiphertext,
      dob_full_ciphertext as dobFullCiphertext,
      nationality_membership_proof as nationalityMembershipProof,
      liveness_score_ciphertext as livenessScoreCiphertext,
      first_name_encrypted as firstNameEncrypted,
      birth_year_offset as birthYearOffset
    FROM identity_proofs
    WHERE user_id = ?
  `);

  const row = stmt.get(userId) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    ...row,
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
    verifiedAt?: string;
    dobCiphertext?: string;
    fheClientKeyId?: string;
    // Document validity and nationality
    docValidityProof?: string;
    nationalityCommitment?: string;
    // FHE expansion
    genderCiphertext?: string;
    dobFullCiphertext?: string;
    // Advanced ZK + liveness FHE
    nationalityMembershipProof?: string;
    livenessScoreCiphertext?: string;
    // User display data
    firstNameEncrypted?: string;
    // Age data for attestation
    birthYearOffset?: number;
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
  // Document validity and nationality
  if (flags.docValidityProof !== undefined) {
    updates.push("doc_validity_proof = ?");
    values.push(flags.docValidityProof);
  }
  if (flags.nationalityCommitment !== undefined) {
    updates.push("nationality_commitment = ?");
    values.push(flags.nationalityCommitment);
  }
  // FHE expansion
  if (flags.genderCiphertext !== undefined) {
    updates.push("gender_ciphertext = ?");
    values.push(flags.genderCiphertext);
  }
  if (flags.dobFullCiphertext !== undefined) {
    updates.push("dob_full_ciphertext = ?");
    values.push(flags.dobFullCiphertext);
  }
  // Advanced ZK + liveness FHE
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
  // Age data for attestation
  if (flags.birthYearOffset !== undefined) {
    updates.push("birth_year_offset = ?");
    values.push(flags.birthYearOffset);
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
  return stmt.get(documentHash) != null;
}

/**
 * Verify a name claim against stored commitment
 */
function _verifyNameClaimForUser(
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
 * Delete user's age proofs (GDPR right to erasure)
 *
 * Removes all ZK proofs and FHE ciphertexts associated with the user.
 */
export function deleteAgeProofs(userId: string): void {
  const stmt = db.prepare(`
    DELETE FROM age_proofs WHERE user_id = ?
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
  const ageProof = getUserAgeProof(userId);

  const checks = {
    document: proof?.isDocumentVerified ?? false,
    liveness: proof?.isLivenessPassed ?? false,
    faceMatch: proof?.isFaceMatched ?? false,
    ageProof: Boolean(ageProof?.isOver18),
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
function _getUserName(userId: string): string | null {
  const stmt = db.prepare(`SELECT name FROM "user" WHERE id = ?`);
  const row = stmt.get(userId) as { name: string } | undefined;
  return row?.name || null;
}

/**
 * Age proof data structure (from age_proofs table)
 */
interface AgeProof {
  proofId: string;
  isOver18: boolean;
  generationTimeMs: number;
  createdAt: string;
  hasFheEncryption: boolean;
  fheEncryptionTimeMs: number | null;
  dobCiphertext: string | null;
}

interface AgeProofPayload {
  proof: string;
  publicSignals: string[];
  isOver18: boolean;
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

/**
 * Get the latest persisted age proof payload (proof + public signals).
 *
 * Used for disclosure flows where a relying party needs the proof material.
 */
export function getUserAgeProofPayload(userId: string): AgeProofPayload | null {
  try {
    const stmt = db.prepare(`
      SELECT proof, public_signals, is_over_18
      FROM age_proofs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(userId) as
      | { proof: string; public_signals: string; is_over_18: number }
      | undefined;

    if (!row) return null;

    const proofValue = JSON.parse(row.proof) as unknown;
    const publicSignalsValue = JSON.parse(row.public_signals) as unknown;
    if (typeof proofValue !== "string") return null;
    if (!Array.isArray(publicSignalsValue)) return null;

    return {
      proof: proofValue,
      publicSignals: publicSignalsValue.map(String),
      isOver18: Boolean(row.is_over_18),
    };
  } catch {
    return null;
  }
}

// Initialize tables on module load, but skip during `next build` to avoid
// SQLite lock contention across build workers.
if (!isSqliteBuildTime()) {
  initializeIdentityProofsTable();
}

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
  const secret = getBetterAuthSecret();

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
async function decryptFirstName(
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
 * Sessions auto-expire after a short TTL (currently 30 minutes).
 *
 * Privacy considerations:
 * - PII is encrypted before storage
 * - Sessions are deleted after successful signup
 * - Expired sessions are automatically cleaned up
 */
function initializeOnboardingSessionsTable(): void {
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

const ONBOARDING_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// RP Authorization Codes (OAuth-style redirect flow)
// ============================================================================

/**
 * RP authorization codes
 *
 * Stores short-lived, single-use codes used by the RP redirect flow.
 *
 * Why a code at all?
 * - Redirect URLs are a leaky channel (history, screenshots, referer headers).
 * - We only return `code` (+ optional `state`) via redirect.
 * - The RP then exchanges that code server-to-server for *minimal* verification flags.
 *
 * This is OAuth-like, but intentionally minimal (closed-beta):
 * - No PKCE/client secrets/scopes/consent yet
 * - Expiry + one-time use provide baseline replay resistance
 */
function initializeRpAuthorizationCodesTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rp_authorization_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      state TEXT,
      user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,

      created_at INTEGER DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_rp_authorization_codes_expires_at
      ON rp_authorization_codes (expires_at);
  `);
}

type RpAuthorizationCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  userId: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
};

const RP_AUTH_CODE_TTL_SECONDS = 5 * 60; // 5 minutes

export function createRpAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  state?: string;
  userId: string;
}): { code: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + RP_AUTH_CODE_TTL_SECONDS;
  const code = crypto.randomUUID();

  const stmt = db.prepare(`
    INSERT INTO rp_authorization_codes (
      code, client_id, redirect_uri, state, user_id, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    code,
    input.clientId,
    input.redirectUri,
    input.state ?? null,
    input.userId,
    now,
    expiresAt,
  );

  return { code, expiresAt };
}

export function consumeRpAuthorizationCode(
  code: string,
): RpAuthorizationCode | null {
  const now = Math.floor(Date.now() / 1000);

  const tx = db.transaction(() => {
    const select = db.prepare(`
      SELECT
        code as code,
        client_id as clientId,
        redirect_uri as redirectUri,
        state as state,
        user_id as userId,
        created_at as createdAt,
        expires_at as expiresAt,
        used_at as usedAt
      FROM rp_authorization_codes
      WHERE code = ? AND expires_at > ? AND used_at IS NULL
    `);

    const row = select.get(code, now) as RpAuthorizationCode | undefined;
    if (!row) return null;

    const update = db.prepare(`
      UPDATE rp_authorization_codes
      SET used_at = ?
      WHERE code = ?
    `);
    update.run(now, code);

    return { ...row, usedAt: now };
  });

  return tx();
}

function _cleanupExpiredRpAuthorizationCodes(): number {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    DELETE FROM rp_authorization_codes
    WHERE expires_at < ?
  `);
  const result = stmt.run(now);
  return result.changes;
}

/**
 * Create or update an onboarding session.
 *
 * Uses atomic INSERT ... ON CONFLICT to prevent race conditions when
 * concurrent requests try to create sessions for the same email.
 */
export function upsertOnboardingSession(
  data: Partial<OnboardingSession> & { email: string },
): OnboardingSession {
  // Normalize email for case-insensitive matching (SQLite is case-sensitive by default)
  const normalizedEmail = data.email.toLowerCase().trim();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.floor(ONBOARDING_SESSION_TTL_MS / 1000);
  const id = crypto.randomUUID();

  // Build dynamic UPDATE clause - only update fields that were explicitly provided
  // Always refresh updated_at and expires_at to extend session lifetime
  const updateClauses: string[] = [
    "updated_at = excluded.updated_at",
    "expires_at = excluded.expires_at",
  ];

  if (data.step !== undefined) {
    updateClauses.push("step = excluded.step");
  }
  if (data.encryptedPii !== undefined) {
    updateClauses.push("encrypted_pii = excluded.encrypted_pii");
  }
  if (data.documentHash !== undefined) {
    updateClauses.push("document_hash = excluded.document_hash");
  }
  if (data.documentProcessed !== undefined) {
    updateClauses.push("document_processed = excluded.document_processed");
  }
  if (data.livenessPassed !== undefined) {
    updateClauses.push("liveness_passed = excluded.liveness_passed");
  }
  if (data.faceMatchPassed !== undefined) {
    updateClauses.push("face_match_passed = excluded.face_match_passed");
  }

  // Atomic upsert: INSERT if new, UPDATE if email already exists
  const stmt = db.prepare(`
    INSERT INTO onboarding_sessions (
      id, email, step, encrypted_pii, document_hash,
      document_processed, liveness_passed, face_match_passed,
      created_at, updated_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      ${updateClauses.join(", ")}
  `);

  stmt.run(
    id,
    normalizedEmail,
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

  const session = getOnboardingSessionByEmail(normalizedEmail);
  if (!session) {
    throw new Error("Failed to upsert onboarding session");
  }
  return session;
}

/**
 * Get onboarding session by email
 */
export function getOnboardingSessionByEmail(
  email: string,
): OnboardingSession | null {
  // Normalize email for case-insensitive matching (SQLite is case-sensitive by default)
  const normalizedEmail = email.toLowerCase().trim();
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

  const row = stmt.get(normalizedEmail, now) as
    | Record<string, unknown>
    | undefined;
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
  // Normalize email for case-insensitive matching (SQLite is case-sensitive by default)
  const normalizedEmail = email.toLowerCase().trim();
  const stmt = db.prepare(`DELETE FROM onboarding_sessions WHERE email = ?`);
  stmt.run(normalizedEmail);
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

// Initialize RP authorization codes table
initializeRpAuthorizationCodesTable();

// ============================================================================
// Blockchain Attestations (Multi-Network)
// ============================================================================

/**
 * Attestation status types
 */
export type AttestationStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed";

/**
 * Blockchain attestation data structure
 */
export interface BlockchainAttestation {
  id: string;
  userId: string;
  walletAddress: string;
  networkId: string;
  chainId: number;
  status: AttestationStatus;
  txHash: string | null;
  blockNumber: number | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  errorMessage: string | null;
  retryCount: number;
}

/**
 * Initialize the blockchain_attestations table.
 *
 * Stores on-chain attestation records for each network the user attests on.
 * Users can attest on multiple networks (one attestation per network).
 */
function initializeBlockchainAttestationsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blockchain_attestations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      wallet_address TEXT NOT NULL,
      network_id TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      tx_hash TEXT,
      block_number INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      confirmed_at TEXT,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      UNIQUE(user_id, network_id)
    );

    CREATE INDEX IF NOT EXISTS idx_attestations_user_id
      ON blockchain_attestations (user_id);
    CREATE INDEX IF NOT EXISTS idx_attestations_network
      ON blockchain_attestations (network_id);
    CREATE INDEX IF NOT EXISTS idx_attestations_status
      ON blockchain_attestations (status);
  `);
}

/**
 * Create a new attestation record
 */
export function createBlockchainAttestation(data: {
  userId: string;
  walletAddress: string;
  networkId: string;
  chainId: number;
}): BlockchainAttestation {
  const id = crypto.randomUUID();

  const stmt = db.prepare(`
    INSERT INTO blockchain_attestations (
      id, user_id, wallet_address, network_id, chain_id, status
    ) VALUES (?, ?, ?, ?, ?, 'pending')
  `);

  stmt.run(id, data.userId, data.walletAddress, data.networkId, data.chainId);

  const attestation = getBlockchainAttestationById(id);
  if (!attestation) {
    throw new Error("Failed to create blockchain attestation");
  }
  return attestation;
}

/**
 * Get attestation by ID (internal helper)
 */
function getBlockchainAttestationById(
  id: string,
): BlockchainAttestation | null {
  const stmt = db.prepare(`
    SELECT
      id, user_id as userId, wallet_address as walletAddress,
      network_id as networkId, chain_id as chainId, status,
      tx_hash as txHash, block_number as blockNumber,
      created_at as createdAt, updated_at as updatedAt,
      confirmed_at as confirmedAt, error_message as errorMessage,
      retry_count as retryCount
    FROM blockchain_attestations
    WHERE id = ?
  `);

  return (stmt.get(id) as BlockchainAttestation | undefined) ?? null;
}

/**
 * Get attestation by user ID and network ID
 */
export function getBlockchainAttestationByUserAndNetwork(
  userId: string,
  networkId: string,
): BlockchainAttestation | null {
  const stmt = db.prepare(`
    SELECT
      id, user_id as userId, wallet_address as walletAddress,
      network_id as networkId, chain_id as chainId, status,
      tx_hash as txHash, block_number as blockNumber,
      created_at as createdAt, updated_at as updatedAt,
      confirmed_at as confirmedAt, error_message as errorMessage,
      retry_count as retryCount
    FROM blockchain_attestations
    WHERE user_id = ? AND network_id = ?
  `);

  return (
    (stmt.get(userId, networkId) as BlockchainAttestation | undefined) ?? null
  );
}

/**
 * Get all attestations for a user
 */
export function getBlockchainAttestationsByUserId(
  userId: string,
): BlockchainAttestation[] {
  const stmt = db.prepare(`
    SELECT
      id, user_id as userId, wallet_address as walletAddress,
      network_id as networkId, chain_id as chainId, status,
      tx_hash as txHash, block_number as blockNumber,
      created_at as createdAt, updated_at as updatedAt,
      confirmed_at as confirmedAt, error_message as errorMessage,
      retry_count as retryCount
    FROM blockchain_attestations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);

  return stmt.all(userId) as BlockchainAttestation[];
}

/**
 * Update attestation status after transaction submission
 */
export function updateBlockchainAttestationSubmitted(
  id: string,
  txHash: string,
): void {
  const stmt = db.prepare(`
    UPDATE blockchain_attestations
    SET status = 'submitted',
        tx_hash = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(txHash, id);
}

/**
 * Update attestation status after transaction confirmation
 */
export function updateBlockchainAttestationConfirmed(
  id: string,
  blockNumber: number | null,
): void {
  const stmt = db.prepare(`
    UPDATE blockchain_attestations
    SET status = 'confirmed',
        block_number = ?,
        confirmed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(blockNumber, id);
}

/**
 * Update attestation status on failure
 */
export function updateBlockchainAttestationFailed(
  id: string,
  errorMessage: string,
): void {
  const stmt = db.prepare(`
    UPDATE blockchain_attestations
    SET status = 'failed',
        error_message = ?,
        retry_count = retry_count + 1,
        updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(errorMessage, id);
}

/**
 * Reset attestation for retry (user can retry after failure)
 */
export function resetBlockchainAttestationForRetry(id: string): void {
  const stmt = db.prepare(`
    UPDATE blockchain_attestations
    SET status = 'pending',
        error_message = NULL,
        updated_at = datetime('now')
    WHERE id = ? AND status = 'failed'
  `);
  stmt.run(id);
}

/**
 * Update attestation wallet address and chain for re-attestation.
 * Called when user re-attests with a different wallet.
 */
export function updateBlockchainAttestationWallet(
  id: string,
  walletAddress: string,
  chainId: number,
): void {
  const stmt = db.prepare(`
    UPDATE blockchain_attestations
    SET wallet_address = ?,
        chain_id = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(walletAddress, chainId, id);
}

/**
 * Delete all attestations for a user (GDPR right to erasure)
 */
export function deleteBlockchainAttestationsByUserId(userId: string): void {
  const stmt = db.prepare(`
    DELETE FROM blockchain_attestations WHERE user_id = ?
  `);
  stmt.run(userId);
}

// Initialize blockchain attestations table
if (!isSqliteBuildTime()) {
  initializeBlockchainAttestationsTable();
}
