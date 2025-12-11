import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user(id)
  )
`);

// Add FHE columns if they don't exist (migration for existing tables)
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

// Create index for user lookups
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_age_proofs_user_id ON age_proofs(user_id)
`);

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if full details are requested
    const { searchParams } = new URL(request.url);
    const full = searchParams.get("full") === "true";

    const stmt = db.prepare(`
      SELECT
        id,
        is_over_18,
        generation_time_ms,
        created_at,
        ${full ? "proof, public_signals, dob_ciphertext, fhe_client_key_id, fhe_encryption_time_ms," : ""}
        1 as _placeholder
      FROM age_proofs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const proofData = stmt.get(session.user.id) as
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
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      proof,
      publicSignals,
      isOver18,
      generationTimeMs,
      // FHE fields (optional)
      dobCiphertext,
      fheClientKeyId,
      fheEncryptionTimeMs,
    } = body;

    if (!proof || !publicSignals || typeof isOver18 !== "boolean") {
      return NextResponse.json(
        { error: "proof, publicSignals, and isOver18 are required" },
        { status: 400 },
      );
    }

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
        fhe_encryption_time_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      proofId,
      session.user.id,
      JSON.stringify(proof),
      JSON.stringify(publicSignals),
      isOver18 ? 1 : 0,
      generationTimeMs || null,
      dobCiphertext || null,
      fheClientKeyId || null,
      fheEncryptionTimeMs || null,
    );

    return NextResponse.json({ success: true, proofId });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to store proof" },
      { status: 500 },
    );
  }
}
