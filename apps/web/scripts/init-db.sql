-- Better Auth tables
CREATE TABLE IF NOT EXISTS "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

CREATE TABLE IF NOT EXISTS "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

-- Indexes for Better Auth tables
CREATE INDEX IF NOT EXISTS "session_userId_idx" on "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx" on "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" on "verification" ("identifier");

-- Application tables
CREATE TABLE IF NOT EXISTS age_proofs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  proof TEXT NOT NULL,
  public_signals TEXT NOT NULL,
  is_over_18 INTEGER NOT NULL,
  generation_time_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  dob_ciphertext TEXT,
  fhe_client_key_id TEXT,
  fhe_encryption_time_ms INTEGER,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  file_data BLOB NOT NULL,
  file_name TEXT NOT NULL,
  file_mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  metadata TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

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
);

CREATE TABLE IF NOT EXISTS identity_proofs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  document_hash TEXT NOT NULL,
  name_commitment TEXT NOT NULL,
  user_salt TEXT NOT NULL,
  dob_ciphertext TEXT,
  fhe_client_key_id TEXT,
  age_proof TEXT,
  age_proof_verified INTEGER DEFAULT 0,
  document_type TEXT,
  country_verified TEXT,
  is_document_verified INTEGER DEFAULT 0,
  is_liveness_passed INTEGER DEFAULT 0,
  is_face_matched INTEGER DEFAULT 0,
  verification_method TEXT,
  verified_at TEXT,
  confidence_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for application tables
CREATE INDEX IF NOT EXISTS idx_age_proofs_user_id ON age_proofs(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status_user_id ON kyc_status(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_proofs_user_id ON identity_proofs (user_id);
CREATE INDEX IF NOT EXISTS idx_identity_proofs_document_hash ON identity_proofs (document_hash);
