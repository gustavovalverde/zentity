/**
 * Age Proof Storage
 *
 * Stores ZK age verification proofs in SQLite. These proofs demonstrate
 * that a user is over 18 without revealing their actual birth year.
 *
 * Privacy: Only the cryptographic proof and public signals are stored.
 * The birth year itself is never persisted—only the encrypted ciphertext
 * (from FHE service) is optionally stored for audit purposes.
 */
import "server-only";

import { getDefaultDatabasePath, getSqliteDb } from "@/lib/db";

const db = getSqliteDb(getDefaultDatabasePath());

let initialized = false;

/**
 * Lazily creates the age_proofs table on first access.
 * Uses SQLite for simple single-file persistence.
 */
function ensureInitialized(): void {
  if (initialized) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS age_proofs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      proof TEXT NOT NULL,
      public_signals TEXT NOT NULL,
      is_over_18 INTEGER NOT NULL,
      generation_time_ms INTEGER,
      dob_ciphertext TEXT,
      fhe_client_key_id TEXT,
      fhe_encryption_time_ms INTEGER,
      circuit_type TEXT,
      noir_version TEXT,
      circuit_hash TEXT,
      bb_version TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_age_proofs_user_id ON age_proofs(user_id)
  `);

  initialized = true;
}

/** Summary view of an age proof (excludes the full proof data). */
type AgeProofSummary = {
  proofId: string;
  isOver18: boolean;
  generationTimeMs: number | null;
  createdAt: string;
  dobCiphertext: string | null;
  fheEncryptionTimeMs: number | null;
};

/** Full age proof including cryptographic proof and circuit metadata. */
export type AgeProofFull = AgeProofSummary & {
  proof: string | null;
  publicSignals: string[] | null;
  fheClientKeyId: string | null;
  circuitType: string | null;
  noirVersion: string | null;
  circuitHash: string | null;
  bbVersion: string | null;
};

/**
 * Retrieves the most recent age proof for a user.
 * @param opts.full - If true, includes the full proof and circuit metadata.
 */
export function getLatestAgeProof(
  userId: string,
  opts?: { full?: boolean },
): AgeProofSummary | AgeProofFull | null {
  ensureInitialized();

  const full = opts?.full === true;

  const stmt = db.prepare(`
    SELECT
      id,
      is_over_18,
      generation_time_ms,
      created_at,
      dob_ciphertext,
      fhe_encryption_time_ms
      ${full ? ", proof, public_signals, fhe_client_key_id, circuit_type, noir_version, circuit_hash, bb_version" : ""}
    FROM age_proofs
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const row = stmt.get(userId) as
    | (AgeProofSummary & {
        id: string;
        is_over_18: number;
        generation_time_ms: number | null;
        created_at: string;
        dob_ciphertext: string | null;
        fhe_encryption_time_ms: number | null;
        proof?: string;
        public_signals?: string;
        fhe_client_key_id?: string | null;
        circuit_type?: string | null;
        noir_version?: string | null;
        circuit_hash?: string | null;
        bb_version?: string | null;
      })
    | undefined;

  if (!row) return null;

  const base: AgeProofSummary = {
    proofId: row.id,
    isOver18: Boolean(row.is_over_18),
    generationTimeMs: row.generation_time_ms,
    createdAt: row.created_at,
    dobCiphertext: row.dob_ciphertext,
    fheEncryptionTimeMs: row.fhe_encryption_time_ms,
  };

  if (!full) return base;

  let proofValue: string | null = null;
  let publicSignalsValue: string[] | null = null;

  try {
    const parsed = JSON.parse(row.proof ?? "null") as unknown;
    if (typeof parsed === "string") proofValue = parsed;
  } catch {}

  try {
    const parsed = JSON.parse(row.public_signals ?? "null") as unknown;
    if (Array.isArray(parsed)) publicSignalsValue = parsed.map(String);
  } catch {}

  return {
    ...base,
    proof: proofValue,
    publicSignals: publicSignalsValue,
    fheClientKeyId: row.fhe_client_key_id ?? null,
    circuitType: row.circuit_type ?? null,
    noirVersion: row.noir_version ?? null,
    circuitHash: row.circuit_hash ?? null,
    bbVersion: row.bb_version ?? null,
  } satisfies AgeProofFull;
}

/**
 * Stores a verified age proof for a user.
 * The proof should be pre-verified before calling this function.
 * @returns The generated proofId for reference.
 */
export function insertAgeProof(args: {
  userId: string;
  proof: string;
  publicSignals: string[];
  isOver18: boolean;
  generationTimeMs?: number;
  dobCiphertext?: string;
  fheClientKeyId?: string;
  fheEncryptionTimeMs?: number;
  circuitType?: string | null;
  noirVersion?: string | null;
  circuitHash?: string | null;
  bbVersion?: string | null;
}): { proofId: string } {
  ensureInitialized();

  const proofId = crypto.randomUUID();

  const stmt = db.prepare(`
    INSERT INTO age_proofs (
      id,
      user_id,
      proof,
      public_signals,
      is_over_18,
      generation_time_ms,
      dob_ciphertext,
      fhe_client_key_id,
      fhe_encryption_time_ms,
      circuit_type,
      noir_version,
      circuit_hash,
      bb_version
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    proofId,
    args.userId,
    JSON.stringify(args.proof),
    JSON.stringify(args.publicSignals),
    args.isOver18 ? 1 : 0,
    args.generationTimeMs ?? null,
    args.dobCiphertext ?? null,
    args.fheClientKeyId ?? null,
    args.fheEncryptionTimeMs ?? null,
    args.circuitType ?? null,
    args.noirVersion ?? null,
    args.circuitHash ?? null,
    args.bbVersion ?? null,
  );

  return { proofId };
}
