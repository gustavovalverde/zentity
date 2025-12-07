/**
 * Database utilities for Zentity
 *
 * This module provides database access for identity proofs and verification data.
 * Uses the same better-sqlite3 instance as Better Auth.
 */

import Database from "better-sqlite3";

// Use the same database as Better Auth
const db = new Database("./dev.db");

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
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Unique constraint: one identity proof per user
    CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_proofs_user_id
      ON identity_proofs (user_id);

    -- Index for duplicate document detection
    CREATE INDEX IF NOT EXISTS idx_identity_proofs_document_hash
      ON identity_proofs (document_hash);
  `);
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
  docValidityProof?: string;       // ZK proof that document is not expired
  nationalityCommitment?: string;  // SHA256(nationality_code + user_salt)
  ageProofsJson?: string;          // JSON: {"18": proof, "21": proof, "25": proof}

  // Sprint 2 additions: FHE expansion
  genderCiphertext?: string;       // FHE encrypted gender (ISO 5218)
  dobFullCiphertext?: string;      // FHE encrypted full DOB as YYYYMMDD (u32)

  // Sprint 3 additions: Advanced ZK + Liveness FHE
  nationalityMembershipProof?: string;  // ZK proof of nationality group membership
  livenessScoreCiphertext?: string;     // FHE encrypted liveness score (0.0-1.0 as u16)
}

/**
 * Create a new identity proof record
 */
export function createIdentityProof(proof: Omit<IdentityProof, "createdAt" | "updatedAt">): void {
  const stmt = db.prepare(`
    INSERT INTO identity_proofs (
      id, user_id, document_hash, name_commitment, user_salt,
      dob_ciphertext, fhe_client_key_id, age_proof, age_proof_verified,
      document_type, country_verified, is_document_verified,
      is_liveness_passed, is_face_matched, verification_method,
      verified_at, confidence_score,
      doc_validity_proof, nationality_commitment, age_proofs_json,
      gender_ciphertext, dob_full_ciphertext,
      nationality_membership_proof, liveness_score_ciphertext
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
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
    proof.livenessScoreCiphertext || null
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
      liveness_score_ciphertext as livenessScoreCiphertext
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
  }
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
  claimedNameHash: string
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

    const proof = stmt.get(userId) as {
      id: string;
      is_over_18: number;
      generation_time_ms: number;
      created_at: string;
      dob_ciphertext: string | null;
      fhe_encryption_time_ms: number | null;
    } | undefined;

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

export default db;
