/**
 * Database utilities for Zentity
 *
 * This module provides database access for identity attestations and verification data.
 * Uses the same `bun:sqlite` instance as Better Auth.
 */

import type {
  AgeProofFull,
  AgeProofSummary,
} from "@/lib/crypto/age-proof-types";

import { EncryptJWT, jwtDecrypt } from "jose";

import { getBetterAuthSecret } from "@/lib/utils/env";

import {
  getDefaultDatabasePath,
  getSqliteDb,
  isSqliteBuildTime,
} from "./sqlite";

const db = getSqliteDb(getDefaultDatabasePath());

/**
 * Check if a document hash already exists (prevent duplicate signups)
 */
export function documentHashExists(documentHash: string): boolean {
  const stmt = db.prepare(`
    SELECT 1 FROM identity_documents WHERE document_hash = ?
  `);
  return stmt.get(documentHash) != null;
}

/**
 * Delete user's identity attestation data (GDPR right to erasure)
 */
export function deleteIdentityData(userId: string): void {
  db.prepare(`DELETE FROM identity_bundles WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM identity_documents WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM zk_proofs WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM encrypted_attributes WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM signed_claims WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM attestation_evidence WHERE user_id = ?`).run(userId);
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
    ageProof: boolean;
    docValidityProof: boolean;
    nationalityProof: boolean;
    faceMatchProof: boolean;
  };
} {
  const selectedDocument = getSelectedIdentityDocumentByUserId(userId);
  const documentId = selectedDocument?.id ?? null;
  const zkProofTypes = documentId
    ? getZkProofTypesByUserAndDocument(userId, documentId)
    : [];
  const signedClaimTypes = documentId
    ? getSignedClaimTypesByUserAndDocument(userId, documentId)
    : [];

  const checks = {
    document: selectedDocument?.status === "verified",
    liveness: signedClaimTypes.includes("liveness_score"),
    ageProof: zkProofTypes.includes("age_verification"),
    docValidityProof: zkProofTypes.includes("doc_validity"),
    nationalityProof: zkProofTypes.includes("nationality_membership"),
    faceMatchProof: zkProofTypes.includes("face_match"),
  };

  const passedChecks = Object.values(checks).filter(Boolean).length;
  const totalChecks = Object.values(checks).length;

  let level: "none" | "basic" | "full" = "none";
  if (passedChecks === totalChecks) {
    level = "full";
  } else if (passedChecks >= Math.ceil(totalChecks / 2)) {
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
 * Get user's age proof (summary view).
 */
export function getUserAgeProof(userId: string): AgeProofSummary | null {
  try {
    const stmt = db.prepare(`
      SELECT id, is_over_18, generation_time_ms, created_at
      FROM zk_proofs
      WHERE user_id = ? AND proof_type = 'age_verification' AND verified = 1
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const proof = stmt.get(userId) as
      | {
          id: string;
          is_over_18: number | null;
          generation_time_ms: number | null;
          created_at: string;
        }
      | undefined;

    if (!proof) return null;

    const encrypted = getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year_offset",
    );

    return {
      proofId: proof.id,
      isOver18: Boolean(proof.is_over_18),
      generationTimeMs: proof.generation_time_ms ?? null,
      createdAt: proof.created_at,
      birthYearOffsetCiphertext: encrypted?.ciphertext ?? null,
      fheEncryptionTimeMs: encrypted?.encryptionTimeMs ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Get user's age proof with full payload.
 */
export function getUserAgeProofFull(userId: string): AgeProofFull | null {
  try {
    const stmt = db.prepare(`
      SELECT
        id,
        is_over_18,
        generation_time_ms,
        created_at,
        proof_payload,
        public_inputs,
        circuit_type,
        noir_version,
        circuit_hash,
        bb_version
      FROM zk_proofs
      WHERE user_id = ? AND proof_type = 'age_verification' AND verified = 1
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(userId) as
      | {
          id: string;
          is_over_18: number | null;
          generation_time_ms: number | null;
          created_at: string;
          proof_payload: string | null;
          public_inputs: string | null;
          circuit_type: string | null;
          noir_version: string | null;
          circuit_hash: string | null;
          bb_version: string | null;
        }
      | undefined;

    if (!row) return null;

    let publicSignalsValue: string[] | null = null;
    if (row.public_inputs) {
      try {
        const parsed = JSON.parse(row.public_inputs) as unknown;
        if (Array.isArray(parsed)) {
          publicSignalsValue = parsed.map(String);
        }
      } catch {}
    }

    const encrypted = getLatestEncryptedAttributeByUserAndType(
      userId,
      "birth_year_offset",
    );

    return {
      proofId: row.id,
      isOver18: Boolean(row.is_over_18),
      generationTimeMs: row.generation_time_ms ?? null,
      createdAt: row.created_at,
      birthYearOffsetCiphertext: encrypted?.ciphertext ?? null,
      fheEncryptionTimeMs: encrypted?.encryptionTimeMs ?? null,
      proof: row.proof_payload ?? null,
      publicSignals: publicSignalsValue,
      fheKeyId: encrypted?.keyId ?? null,
      circuitType: row.circuit_type ?? null,
      noirVersion: row.noir_version ?? null,
      circuitHash: row.circuit_hash ?? null,
      bbVersion: row.bb_version ?? null,
    };
  } catch {
    return null;
  }
}

export function getLatestZkProofPayloadByUserAndType(
  userId: string,
  proofType: string,
  documentId?: string | null,
): { proof: string; publicSignals: string[] } | null {
  const baseQuery = `
    SELECT proof_payload as proofPayload, public_inputs as publicInputs
    FROM zk_proofs
    WHERE user_id = ? AND proof_type = ?
  `;
  const query = documentId
    ? `${baseQuery} AND document_id = ? ORDER BY created_at DESC LIMIT 1`
    : `${baseQuery} ORDER BY created_at DESC LIMIT 1`;
  const stmt = db.prepare(query);
  const row = (
    documentId
      ? stmt.get(userId, proofType, documentId)
      : stmt.get(userId, proofType)
  ) as
    | { proofPayload?: string | null; publicInputs?: string | null }
    | undefined;
  if (!row?.proofPayload || !row.publicInputs) return null;

  try {
    const parsed = JSON.parse(row.publicInputs) as unknown;
    if (!Array.isArray(parsed)) return null;
    return {
      proof: row.proofPayload,
      publicSignals: parsed.map(String),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Attestation Schema (Web2)
// ============================================================================

/**
 * Initialize identity_bundles table.
 *
 * One bundle per user, tracks verification status and policy version.
 */
function initializeIdentityBundlesTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS identity_bundles (
      user_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
      wallet_address TEXT,
      status TEXT DEFAULT 'pending',
      policy_version TEXT,
      issuer_id TEXT,
      attestation_expires_at TEXT,
      fhe_key_id TEXT,
      fhe_public_key TEXT,
      fhe_status TEXT,
      fhe_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_identity_bundles_status
      ON identity_bundles (status);
  `);

  const columnsToAdd = [
    { name: "fhe_key_id", type: "TEXT" },
    { name: "fhe_public_key", type: "TEXT" },
    { name: "fhe_status", type: "TEXT" },
    { name: "fhe_error", type: "TEXT" },
  ];

  for (const col of columnsToAdd) {
    try {
      db.run(`ALTER TABLE identity_bundles ADD COLUMN ${col.name} ${col.type}`);
    } catch {
      // Column already exists, ignore
    }
  }
}

/**
 * Initialize identity_documents table.
 *
 * Multiple verified documents can be associated with one user.
 */
const identityDocumentsColumnsToAdd: Array<{ name: string; type: string }> = [
  { name: "birth_year_offset", type: "INTEGER" },
  { name: "first_name_encrypted", type: "TEXT" },
];

function initializeIdentityDocumentsTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS identity_documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      document_type TEXT,
      issuer_country TEXT,
      document_hash TEXT,
      name_commitment TEXT,
      user_salt TEXT,
      birth_year_offset INTEGER,
      first_name_encrypted TEXT,
      verified_at TEXT,
      confidence_score REAL,
      status TEXT DEFAULT 'verified',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_identity_documents_user_id
      ON identity_documents (user_id);
    CREATE INDEX IF NOT EXISTS idx_identity_documents_doc_hash
      ON identity_documents (document_hash);
  `);

  for (const col of identityDocumentsColumnsToAdd) {
    try {
      db.run(
        `ALTER TABLE identity_documents ADD COLUMN ${col.name} ${col.type}`,
      );
    } catch {
      // Column already exists, ignore
    }
  }
}

/**
 * Initialize zk_proofs table.
 *
 * Stores ZK proof metadata for auditability.
 */
const zkProofColumnsToAdd: Array<{ name: string; type: string }> = [
  { name: "proof_payload", type: "TEXT" },
  { name: "is_over_18", type: "INTEGER" },
  { name: "generation_time_ms", type: "INTEGER" },
  { name: "circuit_type", type: "TEXT" },
  { name: "noir_version", type: "TEXT" },
  { name: "circuit_hash", type: "TEXT" },
  { name: "bb_version", type: "TEXT" },
];

function initializeZkProofsTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS zk_proofs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      document_id TEXT,
      proof_type TEXT NOT NULL,
      proof_hash TEXT NOT NULL,
      proof_payload TEXT,
      public_inputs TEXT,
      is_over_18 INTEGER,
      generation_time_ms INTEGER,
      nonce TEXT,
      policy_version TEXT,
      circuit_type TEXT,
      noir_version TEXT,
      circuit_hash TEXT,
      bb_version TEXT,
      verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_zk_proofs_user_id
      ON zk_proofs (user_id);
    CREATE INDEX IF NOT EXISTS idx_zk_proofs_type
      ON zk_proofs (proof_type);
  `);

  for (const col of zkProofColumnsToAdd) {
    try {
      db.run(`ALTER TABLE zk_proofs ADD COLUMN ${col.name} ${col.type}`);
    } catch {
      // Column already exists, ignore
    }
  }
}

/**
 * Initialize encrypted_attributes table.
 *
 * Stores FHE ciphertexts for private attributes.
 */
function initializeEncryptedAttributesTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS encrypted_attributes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      source TEXT NOT NULL,
      attribute_type TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      key_id TEXT,
      encryption_time_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_encrypted_attributes_user_id
      ON encrypted_attributes (user_id);
    CREATE INDEX IF NOT EXISTS idx_encrypted_attributes_type
      ON encrypted_attributes (attribute_type);
  `);

  try {
    db.run(
      `ALTER TABLE encrypted_attributes ADD COLUMN encryption_time_ms INTEGER`,
    );
  } catch {
    // Column already exists, ignore
  }
}

/**
 * Initialize signed_claims table.
 *
 * Stores server-signed measurements (liveness, face match, OCR signals).
 */
function initializeSignedClaimsTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS signed_claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      document_id TEXT,
      claim_type TEXT NOT NULL,
      claim_payload TEXT NOT NULL,
      signature TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_signed_claims_user_id
      ON signed_claims (user_id);
    CREATE INDEX IF NOT EXISTS idx_signed_claims_type
      ON signed_claims (claim_type);
  `);
}

function initializeAttestationEvidenceTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS attestation_evidence (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
      document_id TEXT NOT NULL,
      policy_version TEXT,
      policy_hash TEXT,
      proof_set_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, document_id)
    );

    CREATE INDEX IF NOT EXISTS idx_attestation_evidence_user_id
      ON attestation_evidence (user_id);
    CREATE INDEX IF NOT EXISTS idx_attestation_evidence_document_id
      ON attestation_evidence (document_id);
  `);
}

export interface IdentityBundle {
  userId: string;
  walletAddress: string | null;
  status: string;
  policyVersion: string | null;
  issuerId: string | null;
  attestationExpiresAt: string | null;
  fheKeyId: string | null;
  fhePublicKey: string | null;
  fheStatus: string | null;
  fheError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityDocument {
  id: string;
  userId: string;
  documentType: string | null;
  issuerCountry: string | null;
  documentHash: string | null;
  nameCommitment: string | null;
  userSalt: string | null;
  birthYearOffset: number | null;
  firstNameEncrypted: string | null;
  verifiedAt: string | null;
  confidenceScore: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ZkProofRecord {
  id: string;
  userId: string;
  documentId: string | null;
  proofType: string;
  proofHash: string;
  publicInputs: string | null;
  nonce: string | null;
  policyVersion: string | null;
  verified: boolean;
  createdAt: string;
}

type ZkProofInsert = {
  id: string;
  userId: string;
  documentId?: string | null;
  proofType: string;
  proofHash: string;
  publicInputs?: string | null;
  nonce?: string | null;
  policyVersion?: string | null;
  verified?: boolean;
  proofPayload?: string | null;
  isOver18?: boolean | null;
  generationTimeMs?: number | null;
  circuitType?: string | null;
  noirVersion?: string | null;
  circuitHash?: string | null;
  bbVersion?: string | null;
};

export interface EncryptedAttributeRecord {
  id: string;
  userId: string;
  source: string;
  attributeType: string;
  ciphertext: string;
  keyId: string | null;
  encryptionTimeMs?: number | null;
  createdAt: string;
}

export interface SignedClaimRecord {
  id: string;
  userId: string;
  documentId: string | null;
  claimType: string;
  claimPayload: string;
  signature: string;
  issuedAt: string;
  createdAt: string;
}

export interface AttestationEvidenceRecord {
  id: string;
  userId: string;
  documentId: string;
  policyVersion: string | null;
  policyHash: string | null;
  proofSetHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getIdentityBundleByUserId(
  userId: string,
): IdentityBundle | null {
  const stmt = db.prepare(`
    SELECT
      user_id as userId,
      wallet_address as walletAddress,
      status,
      policy_version as policyVersion,
      issuer_id as issuerId,
      attestation_expires_at as attestationExpiresAt,
      fhe_key_id as fheKeyId,
      fhe_public_key as fhePublicKey,
      fhe_status as fheStatus,
      fhe_error as fheError,
      created_at as createdAt,
      updated_at as updatedAt
    FROM identity_bundles
    WHERE user_id = ?
    LIMIT 1
  `);

  return (stmt.get(userId) as IdentityBundle | undefined) ?? null;
}

export function getLatestIdentityDocumentByUserId(
  userId: string,
): IdentityDocument | null {
  const stmt = db.prepare(`
    SELECT
      id,
      user_id as userId,
      document_type as documentType,
      issuer_country as issuerCountry,
      document_hash as documentHash,
      name_commitment as nameCommitment,
      user_salt as userSalt,
      birth_year_offset as birthYearOffset,
      first_name_encrypted as firstNameEncrypted,
      verified_at as verifiedAt,
      confidence_score as confidenceScore,
      status,
      created_at as createdAt,
      updated_at as updatedAt
    FROM identity_documents
    WHERE user_id = ?
    ORDER BY
      CASE WHEN verified_at IS NULL THEN 1 ELSE 0 END,
      verified_at DESC,
      created_at DESC
    LIMIT 1
  `);

  return (stmt.get(userId) as IdentityDocument | undefined) ?? null;
}

export function getIdentityDocumentsByUserId(
  userId: string,
): IdentityDocument[] {
  const stmt = db.prepare(`
    SELECT
      id,
      user_id as userId,
      document_type as documentType,
      issuer_country as issuerCountry,
      document_hash as documentHash,
      name_commitment as nameCommitment,
      user_salt as userSalt,
      birth_year_offset as birthYearOffset,
      first_name_encrypted as firstNameEncrypted,
      verified_at as verifiedAt,
      confidence_score as confidenceScore,
      status,
      created_at as createdAt,
      updated_at as updatedAt
    FROM identity_documents
    WHERE user_id = ?
    ORDER BY
      CASE WHEN verified_at IS NULL THEN 1 ELSE 0 END,
      verified_at DESC,
      created_at DESC
  `);

  return stmt.all(userId) as IdentityDocument[];
}

export function getZkProofsByUserId(userId: string): ZkProofRecord[] {
  const stmt = db.prepare(`
    SELECT
      id,
      user_id as userId,
      document_id as documentId,
      proof_type as proofType,
      proof_hash as proofHash,
      public_inputs as publicInputs,
      nonce,
      policy_version as policyVersion,
      verified,
      created_at as createdAt
    FROM zk_proofs
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);

  return stmt.all(userId) as ZkProofRecord[];
}

export function getZkProofTypesByUserAndDocument(
  userId: string,
  documentId: string,
): string[] {
  const stmt = db.prepare(`
    SELECT DISTINCT proof_type as proofType
    FROM zk_proofs
    WHERE user_id = ? AND document_id = ? AND verified = 1
    ORDER BY proof_type ASC
  `);

  return (stmt.all(userId, documentId) as { proofType: string }[]).map(
    (row) => row.proofType,
  );
}

export function getEncryptedAttributeTypesByUserId(userId: string): string[] {
  const stmt = db.prepare(`
    SELECT DISTINCT attribute_type as attributeType
    FROM encrypted_attributes
    WHERE user_id = ?
    ORDER BY attribute_type ASC
  `);

  return (stmt.all(userId) as { attributeType: string }[]).map(
    (row) => row.attributeType,
  );
}

export function getLatestEncryptedAttributeByUserAndType(
  userId: string,
  attributeType: string,
): {
  ciphertext: string;
  keyId: string | null;
  encryptionTimeMs: number | null;
  createdAt: string;
} | null {
  const stmt = db.prepare(`
    SELECT
      ciphertext,
      key_id as keyId,
      encryption_time_ms as encryptionTimeMs,
      created_at as createdAt
    FROM encrypted_attributes
    WHERE user_id = ? AND attribute_type = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return (
    (stmt.get(userId, attributeType) as
      | {
          ciphertext: string;
          keyId: string | null;
          encryptionTimeMs: number | null;
          createdAt: string;
        }
      | undefined) ?? null
  );
}

export function getSignedClaimTypesByUserAndDocument(
  userId: string,
  documentId: string,
): string[] {
  const stmt = db.prepare(`
    SELECT DISTINCT claim_type as claimType
    FROM signed_claims
    WHERE user_id = ? AND document_id = ?
    ORDER BY claim_type ASC
  `);

  return (stmt.all(userId, documentId) as { claimType: string }[]).map(
    (row) => row.claimType,
  );
}

export function getProofHashesByUserAndDocument(
  userId: string,
  documentId: string,
): string[] {
  const stmt = db.prepare(`
    SELECT proof_hash as proofHash
    FROM zk_proofs
    WHERE user_id = ? AND document_id = ? AND verified = 1
    ORDER BY proof_hash ASC
  `);

  return (stmt.all(userId, documentId) as { proofHash: string }[]).map(
    (row) => row.proofHash,
  );
}

export function upsertAttestationEvidence(args: {
  userId: string;
  documentId: string;
  policyVersion: string | null;
  policyHash: string | null;
  proofSetHash: string | null;
}): void {
  const stmt = db.prepare(`
    INSERT INTO attestation_evidence (
      id, user_id, document_id, policy_version, policy_hash, proof_set_hash
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, document_id) DO UPDATE SET
      policy_version = excluded.policy_version,
      policy_hash = excluded.policy_hash,
      proof_set_hash = excluded.proof_set_hash,
      updated_at = datetime('now')
  `);

  stmt.run(
    args.documentId,
    args.userId,
    args.documentId,
    args.policyVersion,
    args.policyHash,
    args.proofSetHash,
  );
}

export function getAttestationEvidenceByUserAndDocument(
  userId: string,
  documentId: string,
): AttestationEvidenceRecord | null {
  const stmt = db.prepare(`
    SELECT
      id,
      user_id as userId,
      document_id as documentId,
      policy_version as policyVersion,
      policy_hash as policyHash,
      proof_set_hash as proofSetHash,
      created_at as createdAt,
      updated_at as updatedAt
    FROM attestation_evidence
    WHERE user_id = ? AND document_id = ?
    LIMIT 1
  `);

  return (
    (stmt.get(userId, documentId) as AttestationEvidenceRecord | undefined) ??
    null
  );
}

export function getSelectedIdentityDocumentByUserId(
  userId: string,
): IdentityDocument | null {
  const documents = getIdentityDocumentsByUserId(userId);
  if (documents.length === 0) return null;

  const proofRows = db
    .prepare(`
    SELECT document_id as documentId, proof_type as proofType, verified
    FROM zk_proofs
    WHERE user_id = ?
  `)
    .all(userId) as Array<{
    documentId: string | null;
    proofType: string;
    verified: number;
  }>;

  const claimRows = db
    .prepare(`
    SELECT document_id as documentId, claim_type as claimType
    FROM signed_claims
    WHERE user_id = ?
  `)
    .all(userId) as Array<{
    documentId: string | null;
    claimType: string;
  }>;

  const proofTypesByDocument = new Map<string, Set<string>>();
  for (const row of proofRows) {
    if (!row.documentId || !row.verified) continue;
    if (!proofTypesByDocument.has(row.documentId)) {
      proofTypesByDocument.set(row.documentId, new Set());
    }
    proofTypesByDocument.get(row.documentId)?.add(row.proofType);
  }

  const claimTypesByDocument = new Map<string, Set<string>>();
  for (const row of claimRows) {
    if (!row.documentId) continue;
    if (!claimTypesByDocument.has(row.documentId)) {
      claimTypesByDocument.set(row.documentId, new Set());
    }
    claimTypesByDocument.get(row.documentId)?.add(row.claimType);
  }

  const requiredProofs = [
    "age_verification",
    "doc_validity",
    "nationality_membership",
    "face_match",
  ];
  const requiredClaims = ["ocr_result", "liveness_score", "face_match_score"];

  const hasAll = (set: Set<string> | undefined, required: string[]) =>
    required.every((item) => set?.has(item));

  for (const doc of documents) {
    if (doc.status !== "verified") continue;
    const proofs = proofTypesByDocument.get(doc.id);
    const claims = claimTypesByDocument.get(doc.id);
    if (hasAll(proofs, requiredProofs) && hasAll(claims, requiredClaims)) {
      return doc;
    }
  }

  for (const doc of documents) {
    if (doc.status === "verified") {
      return doc;
    }
  }

  return documents[0] ?? null;
}

export function upsertIdentityBundle(data: {
  userId: string;
  walletAddress?: string | null;
  status?: string;
  policyVersion?: string | null;
  issuerId?: string | null;
  attestationExpiresAt?: string | null;
  fheKeyId?: string | null;
  fhePublicKey?: string | null;
  fheStatus?: string | null;
  fheError?: string | null;
}): void {
  const stmt = db.prepare(`
    INSERT INTO identity_bundles (
      user_id, wallet_address, status, policy_version, issuer_id, attestation_expires_at,
      fhe_key_id, fhe_public_key, fhe_status, fhe_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      wallet_address = excluded.wallet_address,
      status = excluded.status,
      policy_version = excluded.policy_version,
      issuer_id = excluded.issuer_id,
      attestation_expires_at = excluded.attestation_expires_at,
      fhe_key_id = excluded.fhe_key_id,
      fhe_public_key = excluded.fhe_public_key,
      fhe_status = excluded.fhe_status,
      fhe_error = excluded.fhe_error,
      updated_at = datetime('now')
  `);

  stmt.run(
    data.userId,
    data.walletAddress ?? null,
    data.status ?? "pending",
    data.policyVersion ?? null,
    data.issuerId ?? null,
    data.attestationExpiresAt ?? null,
    data.fheKeyId ?? null,
    data.fhePublicKey ?? null,
    data.fheStatus ?? null,
    data.fheError ?? null,
  );
}

export function updateIdentityBundleStatus(args: {
  userId: string;
  status: string;
  policyVersion?: string | null;
  issuerId?: string | null;
  attestationExpiresAt?: string | null;
}): void {
  const stmt = db.prepare(`
    UPDATE identity_bundles
    SET
      status = ?,
      policy_version = COALESCE(?, policy_version),
      issuer_id = COALESCE(?, issuer_id),
      attestation_expires_at = COALESCE(?, attestation_expires_at),
      updated_at = datetime('now')
    WHERE user_id = ?
  `);

  stmt.run(
    args.status,
    args.policyVersion ?? null,
    args.issuerId ?? null,
    args.attestationExpiresAt ?? null,
    args.userId,
  );
}

export function createIdentityDocument(
  data: Omit<IdentityDocument, "createdAt" | "updatedAt">,
): void {
  const stmt = db.prepare(`
    INSERT INTO identity_documents (
      id, user_id, document_type, issuer_country, document_hash, name_commitment,
      user_salt, birth_year_offset, first_name_encrypted, verified_at, confidence_score, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    data.id,
    data.userId,
    data.documentType ?? null,
    data.issuerCountry ?? null,
    data.documentHash ?? null,
    data.nameCommitment ?? null,
    data.userSalt ?? null,
    data.birthYearOffset ?? null,
    data.firstNameEncrypted ?? null,
    data.verifiedAt ?? null,
    data.confidenceScore ?? null,
    data.status,
  );
}

export function insertZkProofRecord(data: ZkProofInsert): void {
  const stmt = db.prepare(`
    INSERT INTO zk_proofs (
      id,
      user_id,
      document_id,
      proof_type,
      proof_hash,
      proof_payload,
      public_inputs,
      is_over_18,
      generation_time_ms,
      nonce,
      policy_version,
      circuit_type,
      noir_version,
      circuit_hash,
      bb_version,
      verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    data.id,
    data.userId,
    data.documentId ?? null,
    data.proofType,
    data.proofHash,
    data.proofPayload ?? null,
    data.publicInputs ?? null,
    data.isOver18 == null ? null : data.isOver18 ? 1 : 0,
    data.generationTimeMs ?? null,
    data.nonce ?? null,
    data.policyVersion ?? null,
    data.circuitType ?? null,
    data.noirVersion ?? null,
    data.circuitHash ?? null,
    data.bbVersion ?? null,
    data.verified ? 1 : 0,
  );
}

export function insertEncryptedAttribute(
  data: Omit<EncryptedAttributeRecord, "createdAt">,
): void {
  const stmt = db.prepare(`
    INSERT INTO encrypted_attributes (
      id, user_id, source, attribute_type, ciphertext, key_id, encryption_time_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    data.id,
    data.userId,
    data.source,
    data.attributeType,
    data.ciphertext,
    data.keyId ?? null,
    data.encryptionTimeMs ?? null,
  );
}

export function insertSignedClaim(
  data: Omit<SignedClaimRecord, "createdAt">,
): void {
  const stmt = db.prepare(`
    INSERT INTO signed_claims (
      id, user_id, document_id, claim_type, claim_payload, signature, issued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    data.id,
    data.userId,
    data.documentId ?? null,
    data.claimType,
    data.claimPayload,
    data.signature,
    data.issuedAt,
  );
}

export function getLatestSignedClaimByUserTypeAndDocument(
  userId: string,
  claimType: string,
  documentId: string,
): SignedClaimRecord | null {
  const stmt = db.prepare(`
    SELECT
      id, user_id as userId, document_id as documentId, claim_type as claimType,
      claim_payload as claimPayload, signature, issued_at as issuedAt,
      created_at as createdAt
    FROM signed_claims
    WHERE user_id = ? AND claim_type = ? AND document_id = ?
    ORDER BY issued_at DESC
    LIMIT 1
  `);

  return (
    (stmt.get(userId, claimType, documentId) as
      | SignedClaimRecord
      | undefined) ?? null
  );
}

// Initialize attestation schema tables.
if (!isSqliteBuildTime()) {
  initializeIdentityBundlesTable();
  initializeIdentityDocumentsTable();
  initializeZkProofsTable();
  initializeEncryptedAttributesTable();
  initializeSignedClaimsTable();
  initializeAttestationEvidenceTable();
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
 * Encrypt user salt using JWE (AES-256-GCM)
 *
 * User salt is required to verify commitments but should not be stored in plaintext.
 */
export async function encryptUserSalt(userSalt: string): Promise<string> {
  const secret = await getEncryptionSecret();

  const token = await new EncryptJWT({ userSalt })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .encrypt(secret);

  return token;
}

/**
 * Decrypt user salt from JWE token
 *
 * @returns The decrypted salt, or null if decryption fails
 */
export async function decryptUserSalt(
  encryptedToken: string,
): Promise<string | null> {
  try {
    const secret = await getEncryptionSecret();
    const { payload } = await jwtDecrypt(encryptedToken, secret);
    return (payload.userSalt as string) || null;
  } catch {
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
  const document = getSelectedIdentityDocumentByUserId(userId);
  if (!document?.firstNameEncrypted) return null;

  return decryptFirstName(document.firstNameEncrypted);
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
  db.run(`
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
  db.run(`
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
  db.run(`
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
