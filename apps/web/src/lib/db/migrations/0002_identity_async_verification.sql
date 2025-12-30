-- Add identity draft tracking to onboarding sessions
ALTER TABLE onboarding_sessions
  ADD COLUMN identity_draft_id TEXT;

-- Drafts for precomputed OCR + liveness
CREATE TABLE IF NOT EXISTS identity_verification_drafts (
  id TEXT PRIMARY KEY,
  onboarding_session_id TEXT NOT NULL,
  user_id TEXT REFERENCES "user" ("id") ON DELETE SET NULL,
  document_id TEXT NOT NULL,
  document_processed INTEGER DEFAULT 0,
  is_document_valid INTEGER DEFAULT 0,
  is_duplicate_document INTEGER DEFAULT 0,
  document_type TEXT,
  issuer_country TEXT,
  document_hash TEXT,
  document_hash_field TEXT,
  name_commitment TEXT,
  user_salt TEXT,
  birth_year INTEGER,
  birth_year_offset INTEGER,
  expiry_date_int INTEGER,
  nationality_code TEXT,
  nationality_code_numeric INTEGER,
  country_code_numeric INTEGER,
  confidence_score REAL,
  first_name_encrypted TEXT,
  ocr_issues TEXT,
  antispoof_score REAL,
  live_score REAL,
  liveness_passed INTEGER,
  face_match_confidence REAL,
  face_match_passed INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- DB-backed queue for identity finalization
CREATE TABLE IF NOT EXISTS identity_verification_jobs (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  fhe_key_id TEXT,
  fhe_public_key TEXT,
  result TEXT,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_identity_drafts_session
  ON identity_verification_drafts (onboarding_session_id);
CREATE INDEX IF NOT EXISTS idx_identity_drafts_user
  ON identity_verification_drafts (user_id);
CREATE INDEX IF NOT EXISTS idx_identity_drafts_document
  ON identity_verification_drafts (document_id);
CREATE INDEX IF NOT EXISTS idx_identity_jobs_draft
  ON identity_verification_jobs (draft_id);
CREATE INDEX IF NOT EXISTS idx_identity_jobs_status
  ON identity_verification_jobs (status);
CREATE INDEX IF NOT EXISTS idx_identity_jobs_user
  ON identity_verification_jobs (user_id);
