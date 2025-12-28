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

CREATE TABLE IF NOT EXISTS identity_bundles (
  user_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  wallet_address TEXT,
  status TEXT DEFAULT 'pending',
  policy_version TEXT,
  issuer_id TEXT,
  attestation_expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

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
CREATE INDEX IF NOT EXISTS idx_identity_bundles_status ON identity_bundles (status);
CREATE INDEX IF NOT EXISTS idx_identity_documents_user_id ON identity_documents (user_id);
CREATE INDEX IF NOT EXISTS idx_identity_documents_doc_hash ON identity_documents (document_hash);
CREATE INDEX IF NOT EXISTS idx_zk_proofs_user_id ON zk_proofs (user_id);
CREATE INDEX IF NOT EXISTS idx_zk_proofs_type ON zk_proofs (proof_type);
CREATE INDEX IF NOT EXISTS idx_encrypted_attributes_user_id ON encrypted_attributes (user_id);
CREATE INDEX IF NOT EXISTS idx_encrypted_attributes_type ON encrypted_attributes (attribute_type);
CREATE INDEX IF NOT EXISTS idx_signed_claims_user_id ON signed_claims (user_id);
CREATE INDEX IF NOT EXISTS idx_signed_claims_type ON signed_claims (claim_type);
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

-- RP (Relying Party) authorization codes for OAuth-style redirect flow
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

CREATE INDEX IF NOT EXISTS idx_rp_authorization_codes_expires_at ON rp_authorization_codes (expires_at);
