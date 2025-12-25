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
CREATE TABLE IF NOT EXISTS zk_challenges (
  nonce TEXT PRIMARY KEY,
  circuit_type TEXT NOT NULL,
  user_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

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
  circuit_type TEXT,
  noir_version TEXT,
  circuit_hash TEXT,
  bb_version TEXT,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  -- PRIVACY: do not store image bytes; only metadata is persisted.
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
  document_type TEXT,
  country_verified TEXT,
  is_document_verified INTEGER DEFAULT 0,
  is_liveness_passed INTEGER DEFAULT 0,
  is_face_matched INTEGER DEFAULT 0,
  verification_method TEXT,
  verified_at TEXT,
  confidence_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  doc_validity_proof TEXT,            -- ZK proof that document is not expired
  nationality_commitment TEXT,        -- SHA256(nationality_code + user_salt), ISO 3166-1 alpha-3
  gender_ciphertext TEXT,             -- FHE encrypted gender (ISO 5218: 0=Unknown, 1=Male, 2=Female, 9=N/A)
  dob_full_ciphertext TEXT,           -- FHE encrypted full DOB as YYYYMMDD (u32)
  nationality_membership_proof TEXT,  -- ZK proof of nationality group membership (EU, SCHENGEN, etc.)
  liveness_score_ciphertext TEXT,     -- FHE encrypted liveness score (0.0-1.0 as u16 0-10000)
  first_name_encrypted TEXT           -- JWE encrypted first name for dashboard display
);

-- Temporary onboarding sessions (encrypted wizard state)
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  step INTEGER DEFAULT 1,
  -- PRIVACY: encrypted wizard state only (JWE / AES-256-GCM), short-lived via expires_at TTL.
  encrypted_pii TEXT,
  document_hash TEXT,                 -- SHA256 of uploaded document (for dedup)
  document_processed INTEGER DEFAULT 0,
  liveness_passed INTEGER DEFAULT 0,
  face_match_passed INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  expires_at INTEGER                  -- Unix timestamp for auto-expiration (enforced by app)
);

-- Indexes for application tables
CREATE INDEX IF NOT EXISTS idx_zk_challenges_expires_at ON zk_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_age_proofs_user_id ON age_proofs(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status_user_id ON kyc_status(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_proofs_user_id ON identity_proofs (user_id);
CREATE INDEX IF NOT EXISTS idx_identity_proofs_document_hash ON identity_proofs (document_hash);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_expires_at ON onboarding_sessions(expires_at);

-- Blockchain attestations (multi-network)
CREATE TABLE IF NOT EXISTS blockchain_attestations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  network_id TEXT NOT NULL,           -- "fhevm_sepolia", "hardhat", etc.
  chain_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',      -- pending, submitted, confirmed, failed
  tx_hash TEXT,
  block_number INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  confirmed_at TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  UNIQUE(user_id, network_id)         -- User can attest once per network
);

CREATE INDEX IF NOT EXISTS idx_attestations_user_id ON blockchain_attestations(user_id);
CREATE INDEX IF NOT EXISTS idx_attestations_network ON blockchain_attestations(network_id);
CREATE INDEX IF NOT EXISTS idx_attestations_status ON blockchain_attestations(status);
