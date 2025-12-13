import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { type NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { consumeChallenge } from "@/lib/challenge-store";
import { verifyNoirProof } from "@/lib/noir-verifier";
import {
  CIRCUIT_SPECS,
  normalizeChallengeNonce,
  parsePublicInputToNumber,
} from "@/lib/zk-circuit-spec";

// Server-enforced minimum age policy
const MIN_AGE_POLICY = 18;

// Use DATABASE_PATH env var for Docker volume persistence, default to ./dev.db for local dev
const dbPath = process.env.DATABASE_PATH || "./dev.db";

// Ensure the database directory exists
const dbDir = path.dirname(dbPath);
if (dbDir !== "." && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize the age_proofs table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS age_proofs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    proof TEXT NOT NULL,
    public_signals TEXT NOT NULL,
    is_over_18 INTEGER NOT NULL,
    generation_time_ms INTEGER,
    circuit_type TEXT,
    noir_version TEXT,
    circuit_hash TEXT,
    bb_version TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user(id)
  )
`);

// Add columns if they don't exist
const tableInfo = db.pragma("table_info(age_proofs)") as { name: string }[];
const columnNames = tableInfo.map((col) => col.name);

if (!columnNames.includes("dob_ciphertext")) {
  db.exec(`ALTER TABLE age_proofs ADD COLUMN dob_ciphertext TEXT`);
}
if (!columnNames.includes("fhe_client_key_id")) {
  db.exec(`ALTER TABLE age_proofs ADD COLUMN fhe_client_key_id TEXT`);
}
if (!columnNames.includes("fhe_encryption_time_ms")) {
  db.exec(`ALTER TABLE age_proofs ADD COLUMN fhe_encryption_time_ms INTEGER`);
}
if (!columnNames.includes("circuit_type")) {
  db.exec(`ALTER TABLE age_proofs ADD COLUMN circuit_type TEXT`);
}
if (!columnNames.includes("noir_version")) {
  db.exec(`ALTER TABLE age_proofs ADD COLUMN noir_version TEXT`);
}
if (!columnNames.includes("circuit_hash")) {
  db.exec(`ALTER TABLE age_proofs ADD COLUMN circuit_hash TEXT`);
}
if (!columnNames.includes("bb_version")) {
  db.exec(`ALTER TABLE age_proofs ADD COLUMN bb_version TEXT`);
}

// Create index for user lookups
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_age_proofs_user_id ON age_proofs(user_id)
`);

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    // Check if full details are requested
    const { searchParams } = new URL(request.url);
    const full = searchParams.get("full") === "true";

    const stmt = db.prepare(`
      SELECT
        id,
        is_over_18,
        generation_time_ms,
        created_at,
        ${
          full
            ? "proof, public_signals, dob_ciphertext, fhe_client_key_id, fhe_encryption_time_ms, circuit_type, noir_version, circuit_hash, bb_version,"
            : ""
        }
        1 as _placeholder
      FROM age_proofs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const proofData = stmt.get(authResult.session.user.id) as
      | {
          id: string;
          is_over_18: number;
          generation_time_ms: number;
          created_at: string;
          proof?: string;
          public_signals?: string;
          dob_ciphertext?: string;
          fhe_client_key_id?: string;
          fhe_encryption_time_ms?: number;
          circuit_type?: string;
          noir_version?: string;
          circuit_hash?: string;
          bb_version?: string;
        }
      | undefined;

    if (!proofData) {
      return NextResponse.json({ error: "No proof found" }, { status: 404 });
    }

    const response: Record<string, unknown> = {
      proofId: proofData.id,
      isOver18: Boolean(proofData.is_over_18),
      generationTimeMs: proofData.generation_time_ms,
      createdAt: proofData.created_at,
    };

    // Include full details if requested
    if (full) {
      response.proof = proofData.proof ? JSON.parse(proofData.proof) : null;
      response.publicSignals = proofData.public_signals
        ? JSON.parse(proofData.public_signals)
        : null;
      response.dobCiphertext = proofData.dob_ciphertext || null;
      response.fheClientKeyId = proofData.fhe_client_key_id || null;
      response.fheEncryptionTimeMs = proofData.fhe_encryption_time_ms || null;
      response.circuitType = proofData.circuit_type || null;
      response.noirVersion = proofData.noir_version || null;
      response.circuitHash = proofData.circuit_hash || null;
      response.bbVersion = proofData.bb_version || null;
    }

    return NextResponse.json(response);
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to retrieve proof" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;
    const userId = authResult.session.user.id;

    const body = await request.json();
    const {
      proof,
      publicSignals,
      generationTimeMs,
      // FHE fields (optional)
      dobCiphertext,
      fheClientKeyId,
      fheEncryptionTimeMs,
    } = body;

    // NOTE: isOver18 is intentionally NOT extracted from the body.
    // It MUST be derived from the cryptographically verified proof.

    // Validate required fields
    if (!proof || !publicSignals) {
      return NextResponse.json(
        { error: "proof and publicSignals are required" },
        { status: 400 },
      );
    }

    // Validate public signals format
    // Age circuit public inputs: [current_year, min_age, nonce, is_old_enough]
    const ageSpec = CIRCUIT_SPECS.age_verification;
    if (
      !Array.isArray(publicSignals) ||
      publicSignals.length < ageSpec.minPublicInputs
    ) {
      return NextResponse.json(
        {
          error: `publicSignals must have at least ${ageSpec.minPublicInputs} elements: [current_year, min_age, nonce, is_old_enough]`,
        },
        { status: 400 },
      );
    }

    // Parse public inputs from hex/decimal strings
    // NOTE: nonce is at index 2, isOldEnough is at index 3
    const providedYear = parsePublicInputToNumber(publicSignals[0]);
    const providedMinAge = parsePublicInputToNumber(publicSignals[1]);
    const isOldEnough = parsePublicInputToNumber(
      publicSignals[ageSpec.resultIndex],
    );
    const actualYear = new Date().getFullYear();

    // Policy enforcement: reject stale proofs (year must be within 1 year)
    if (Math.abs(providedYear - actualYear) > 1) {
      return NextResponse.json(
        {
          error: `Invalid proof year: ${providedYear} (expected ~${actualYear})`,
        },
        { status: 400 },
      );
    }

    // Policy enforcement: min_age must meet server policy
    if (providedMinAge < MIN_AGE_POLICY) {
      return NextResponse.json(
        {
          error: `min_age ${providedMinAge} below policy minimum ${MIN_AGE_POLICY}`,
        },
        { status: 400 },
      );
    }

    // Cryptographically verify the proof using Noir/UltraHonk
    const verificationResult = await verifyNoirProof({
      proof,
      publicInputs: publicSignals,
      circuitType: "age_verification",
    });

    if (!verificationResult.isValid) {
      return NextResponse.json(
        { error: "Proof verification failed: invalid cryptographic proof" },
        { status: 400 },
      );
    }

    // CRITICAL: Extract isOver18 from the PROOF, not from the request body
    // The circuit output (publicInputs[3]) is the authoritative source
    if (isOldEnough !== 1) {
      return NextResponse.json(
        { error: "Age requirement not met: proof shows user is not over 18" },
        { status: 400 },
      );
    }

    // Enforce replay resistance for persisted proofs:
    // nonce MUST come from the server challenge store and is one-time use.
    const nonceHex = normalizeChallengeNonce(publicSignals[ageSpec.nonceIndex]);
    const challenge = consumeChallenge(nonceHex, "age_verification", userId);
    if (!challenge) {
      return NextResponse.json(
        { error: "Invalid or expired challenge nonce" },
        { status: 400 },
      );
    }

    // At this point, the proof is cryptographically valid AND shows isOldEnough === 1
    const isOver18 = true; // Derived from verified proof, not from request body

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
      userId,
      JSON.stringify(proof),
      JSON.stringify(publicSignals),
      isOver18 ? 1 : 0,
      generationTimeMs || null,
      dobCiphertext || null,
      fheClientKeyId || null,
      fheEncryptionTimeMs || null,
      verificationResult.circuitType,
      verificationResult.noirVersion,
      verificationResult.circuitHash,
      verificationResult.bbVersion,
    );

    return NextResponse.json({
      success: true,
      proofId,
      isOver18, // Return the server-verified value
      verificationTimeMs: verificationResult.verificationTimeMs,
      circuitType: verificationResult.circuitType,
      noirVersion: verificationResult.noirVersion,
      circuitHash: verificationResult.circuitHash,
      bbVersion: verificationResult.bbVersion,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to store proof",
      },
      { status: 500 },
    );
  }
}
