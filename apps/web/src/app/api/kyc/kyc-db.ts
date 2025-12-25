import { getDefaultDatabasePath, getSqliteDb } from "@/lib/db";

const db = getSqliteDb(getDefaultDatabasePath());

// Initialize the kyc_documents table if it doesn't exist
// PRIVACY: We do NOT store file_data (image bytes) - only metadata for tracking
// Images are processed transiently and discarded immediately after verification
db.run(`
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
db.run(`
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
db.run(`
  CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id ON kyc_documents(user_id)
`);
db.run(`
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
    db.run(
      `UPDATE kyc_documents SET file_data = NULL WHERE file_data IS NOT NULL`,
    );
  }
} catch {
  // Table might not exist yet
}

export { db };
