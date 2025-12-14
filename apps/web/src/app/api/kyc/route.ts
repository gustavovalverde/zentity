import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getDefaultDatabasePath, getSqliteDb } from "@/lib/sqlite";

const db = getSqliteDb(getDefaultDatabasePath());

// Initialize the kyc_documents table if it doesn't exist
// PRIVACY: We do NOT store file_data (image bytes) - only metadata for tracking
// Images are processed transiently and discarded immediately after verification
db.exec(`
  CREATE TABLE IF NOT EXISTS kyc_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    verified_at TEXT,
    FOREIGN KEY (user_id) REFERENCES user(id)
  )
`);

// Initialize the kyc_status table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS kyc_status (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    document_uploaded INTEGER DEFAULT 0,
    document_verified INTEGER DEFAULT 0,
    selfie_uploaded INTEGER DEFAULT 0,
    selfie_verified INTEGER DEFAULT 0,
    face_match_score REAL,
    kyc_completed INTEGER DEFAULT 0,
    kyc_level TEXT DEFAULT 'none',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user(id)
  )
`);

// Create indexes for user lookups
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id ON kyc_documents(user_id)
`);
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_kyc_status_user_id ON kyc_status(user_id)
`);

// Privacy: Ensure file_data column (if present) is always null
try {
  const hasFileData = db
    .prepare(`
    SELECT COUNT(*) as count FROM pragma_table_info('kyc_documents') WHERE name = 'file_data'
  `)
    .get() as { count: number };

  if (hasFileData.count > 0) {
    db.exec(
      `UPDATE kyc_documents SET file_data = NULL WHERE file_data IS NOT NULL`,
    );
  }
} catch {
  // Table might not exist yet
}

export interface KycStatusResponse {
  documentUploaded: boolean;
  documentVerified: boolean;
  selfieUploaded: boolean;
  selfieVerified: boolean;
  faceMatchScore: number | null;
  kycCompleted: boolean;
  kycLevel: "none" | "basic" | "enhanced" | "full";
  updatedAt: string | null;
}

export async function GET(): Promise<
  NextResponse<KycStatusResponse | { error: string }>
> {
  try {
    const authResult = await requireSession();
    if (!authResult.ok) return authResult.response;

    const stmt = db.prepare(`
      SELECT
        document_uploaded,
        document_verified,
        selfie_uploaded,
        selfie_verified,
        face_match_score,
        kyc_completed,
        kyc_level,
        updated_at
      FROM kyc_status
      WHERE user_id = ?
    `);

    const status = stmt.get(authResult.session.user.id) as
      | {
          document_uploaded: number;
          document_verified: number;
          selfie_uploaded: number;
          selfie_verified: number;
          face_match_score: number | null;
          kyc_completed: number;
          kyc_level: string;
          updated_at: string | null;
        }
      | undefined;

    if (!status) {
      return NextResponse.json({
        documentUploaded: false,
        documentVerified: false,
        selfieUploaded: false,
        selfieVerified: false,
        faceMatchScore: null,
        kycCompleted: false,
        kycLevel: "none" as const,
        updatedAt: null,
      });
    }

    return NextResponse.json({
      documentUploaded: Boolean(status.document_uploaded),
      documentVerified: Boolean(status.document_verified),
      selfieUploaded: Boolean(status.selfie_uploaded),
      selfieVerified: Boolean(status.selfie_verified),
      faceMatchScore: status.face_match_score,
      kycCompleted: Boolean(status.kyc_completed),
      kycLevel: status.kyc_level as "none" | "basic" | "enhanced" | "full",
      updatedAt: status.updated_at,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to retrieve KYC status" },
      { status: 500 },
    );
  }
}

// Helper function to create or update KYC status
export function ensureKycStatus(userId: string): void {
  const checkStmt = db.prepare(`SELECT id FROM kyc_status WHERE user_id = ?`);
  const existing = checkStmt.get(userId);

  if (!existing) {
    const insertStmt = db.prepare(`
      INSERT INTO kyc_status (id, user_id, kyc_level)
      VALUES (?, ?, 'none')
    `);
    insertStmt.run(crypto.randomUUID(), userId);
  }
}

// Helper function to calculate KYC level
export function calculateKycLevel(
  documentUploaded: boolean,
  documentVerified: boolean,
  selfieUploaded: boolean,
  selfieVerified: boolean,
): "none" | "basic" | "enhanced" | "full" {
  if (documentVerified && selfieVerified) return "full";
  if (documentVerified || selfieVerified) return "enhanced";
  if (documentUploaded || selfieUploaded) return "basic";
  return "none";
}
