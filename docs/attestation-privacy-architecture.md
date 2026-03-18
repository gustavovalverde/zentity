# Attestation & Privacy Architecture

> **Purpose**: Single source of truth for attestation schema, data classification, and privacy boundaries.

## Executive Summary

Zentity separates **eligibility proofs (ZK)**, **sensitive attributes (FHE)**, **audit metadata (hashes + signatures)**, and **client‑held keys (Passkeys + OPAQUE + Wallet)** so banks, exchanges, and Web3 protocols can verify compliance **without receiving raw PII**. These cryptographic pillars are used together throughout the system.

- **ZK proofs**: age (day-precise), document validity, nationality membership, face match threshold, identity binding (replay protection).
- **FHE encryption**: DOB days (days since 1900-01-01) for server-side age threshold computation, liveness score for server-side threshold checks.
- **Commitments + hashes**: document hash, name commitment, DOB commitment, address commitment, proof hashes.
- **Screening attestations**: PEP/sanctions screening results stored as signed claims (boolean + provider + timestamp).
- **Passkeys + OPAQUE + Wallet (auth + key custody)**: passkeys for passwordless auth and PRF‑derived KEKs; OPAQUE for password auth with client‑derived export keys; wallet signatures (EIP-712) for Web3‑native auth with HKDF‑derived KEKs. All three methods wrap secrets client‑side.
- **Evidence pack**: `policy_hash` + `proof_set_hash` for durable auditability.
- **User-only decryption**: client keys are stored server-side as passkey‑, OPAQUE‑, or wallet‑wrapped encrypted secrets—only the user can unwrap them in the browser.

This model supports **multi-document identities**, **revocable attestations**, **periodic re-verification**, and **auditable disclosures** across Web2 and Web3.

### Regulatory Alignment

Zentity provides the cryptographic infrastructure; the relying party determines which regulatory requirements apply to their use case. This architecture supports:

- **US (FinCEN CIP Rule)**: Full DOB precision, address collection, name verification
- **EU (AMLD5/AMLD6)**: 5-year retention, PEP/sanctions screening, re-verification scheduling
- **FATF Travel Rule**: Address collection + eligibility disclosures with minimal data release

---

## Trust & Privacy Boundaries

### Core trust model

- **Browser is untrusted for integrity** (users can tamper with client code).
- **Browser is best for privacy** (ZK proofs + passkey/OPAQUE/wallet-based key custody).
- **Passkeys + OPAQUE + Wallet are the auth + key custody anchors** (WebAuthn signatures prove user presence; PRF outputs, OPAQUE export keys, and wallet signatures derive KEKs locally and never leave the client).
- **Server is trusted for integrity** (verification, signing, policy enforcement).
- **Server is not trusted for plaintext access** (only commitments + ciphertext).
- **Client storage (sessionStorage/localStorage) is not used for PII**. Verification data exists only in memory during the active flow. If the user refreshes, the state is lost and they restart verification. Long-term PII is stored only as credential-encrypted secrets (profile vault).

### Encryption boundaries

| Layer | What happens | Who can decrypt | Why |
|---|---|---|---|
| **Web2 (off-chain)** | TFHE encryption via FHE service using client public key | **User only** (client key in browser) | Server can compute on ciphertext without decryption. |
| **Web3 (on-chain)** | Attestation encryption via registrar (server relayer SDK); client SDK used for wallet-initiated ops (transfers, decrypt) | **User only** (wallet signature auth) | On-chain compliance checks operate on ciphertext; decryption is user-authorized. |

**Important**: The server persists **encrypted key bundles** (passkey‑, OPAQUE‑, or wallet‑wrapped) and registers **public + server keys** with the FHE service under a `key_id`. Client keys are only decryptable in the browser.

### Why the server can't decrypt

- The browser encrypts data with a random **data key (DEK)**.
- That DEK is wrapped by a **key‑encryption key (KEK)** derived client‑side.
- The server stores only the encrypted blob + wrapped DEK, but **never sees the KEK source material**.
- Result: the server can store and verify, but cannot decrypt user data.

### Integrity controls

- All ZK proofs include a **server-issued nonce** (replay protection).
- Proofs are **verified server-side**; on-chain InputVerifier validates FHE input proofs.
- High-risk measurements (OCR results, liveness, face match) are **server-signed claims**.
- Proofs are **bound to a claim hash** to prevent client tampering.
- **Identity binding proofs** cryptographically link proofs to a specific user via Poseidon2 commitment, preventing proof replay across users or documents. No proofs can be generated without binding. Works with all three auth modes (passkey PRF, OPAQUE export key, wallet signature).
- Passkey authentication is **origin-bound** and uses **signature counters** to reduce replay and phishing risk.
- OPAQUE authentication keeps raw passwords off the server; clients verify the server's static public key (pinned in production).
- Passkey PRF-derived KEKs are **credential-bound**; secret wrappers reference the credential ID + PRF salt.
- **DPoP nonces**: server-issued single-use tokens prevent DPoP proof replay (RFC 9449).
- **KB-JWT freshness**: verifiers enforce max age on Key Binding JWT timestamps.
- **x509_hash client binding**: OID4VP verifier identity bound to leaf certificate thumbprint.
- **FHE ciphertext HMAC binding**: HMAC-SHA256 keyed by `CIPHERTEXT_HMAC_SECRET` (HKDF-derived) over length-prefixed `[userId, attributeType, ciphertext]`, stored in `ciphertext_hash`, verified with `timingSafeEqual` on every read. Detects ciphertext swap attacks.
- **Consent scope HMAC**: HMAC-SHA256 keyed by an HKDF derivation of `BETTER_AUTH_SECRET` over length-prefixed `[context, userId, clientId, referenceId, sortedScopes]`, stored in `scope_hmac`. Detects DB-level scope escalation.
- **JWKS private key encryption at rest**: AES-256-GCM envelope encryption via `KEY_ENCRYPTION_KEY` (required in production). Prevents token forgery from DB read access. Stored format: `{"v":1,"iv":"...","ct":"..."}`.
- **JARM response encryption**: ECDH-ES P-256 key encrypts OID4VP presentation responses. Keys rotate every 90 days with grace period for in-flight decryption.

---

## Data Classification Matrix

**Legend:** ✅ primary form, ◐ optional/derived, — not used.
**Vault** = passkey‑sealed profile or passkey‑wrapped encrypted secrets **stored in the server DB as encrypted blobs** and only decryptable client‑side after a passkey PRF unlock.

### Core Identity & Eligibility

| Data / Claim | ZK | FHE | Commit | Vault | Notes |
|---|---|---|---|---|---|
| Age >= threshold | ✅ | ◐ | Proof hash | — | Boolean eligibility; no DOB revealed. Uses `dobDays` for day-level precision. |
| Document validity | ✅ | — | Proof hash | — | Binary eligibility; no expiry disclosure. |
| Nationality in allowlist | ✅ | ◐ | Merkle root | — | Group membership only (EU, US, etc.). |
| Face match >= threshold | ✅ | — | Proof hash | — | Pass/fail only. |
| Liveness score | — | ✅ | Signed claim | — | Score stays private; server attests. |
| Compliance level | — | ✅ | Server-derived | — | Policy gating input. Derived by `deriveComplianceStatus()` pure function from ZK proof existence + signed claim types (no mutable booleans). Levels: `none`(1), `basic`(2), `full`(3), `chip`(4). NFC chip path derives from `chip_verification` claim type presence (boolean payloads ignored). See [Architecture: Compliance Derivation Engine](architecture.md#compliance-derivation-engine). |

### DOB Storage (Production)

| Data | ZK | FHE | Commit | Vault | Notes |
|---|---|---|---|---|---|
| DOB days since 1900-01-01 | ◐ | ✅ | — | — | Full date precision for compliance. u32 days since 1900-01-01 (UTC). |
| DOB commitment | — | — | ✅ | — | SHA256(dob + salt) for audit trail. |

### Geographic & Address

| Data | ZK | FHE | Commit | Vault | Notes |
|---|---|---|---|---|---|
| Nationality | ✅ | — | — | ✅ | Proven once via ZK (nationality membership proof). Stored in profile vault for OAuth disclosure. |
| Address country code | ◐ | — | — | — | Country code from residential address. Stored as plaintext integer on `identity_bundles` and `identity_verifications`. |
| Address commitment | — | — | ✅ | — | **NEW**: SHA256(address + salt) for audit. |

### Screening & Risk (Server-Side)

| Data | ZK | FHE | Commit | Vault | Notes |
|---|---|---|---|---|---|
| PEP screening result | — | — | Signed claim | — | **NEW**: Boolean result + attestation. |
| Sanctions screening result | — | — | Signed claim | — | **NEW**: Boolean result + attestation. |
| Risk level | — | — | Server-derived | — | **NEW**: low/medium/high/critical. |
| Risk score | — | — | — | — | Numeric score (0-100). Stored as plaintext integer on `identity_bundles`. |

### Identity & Vault

| Data | ZK | FHE | Commit | Vault | Notes |
|---|---|---|---|---|---|
| Name (full name) | — | — | ✅ | ✅ | Commitment for audit; plaintext only in vault. |
| Profile PII (DOB, document #, nationality, document type, issuing country) | — | — | — | ✅ | Stored only in vault. Created after document OCR with cached credential material. |
| Address (full plaintext) | — | — | — | ✅ | **NEW**: Plaintext only in vault. |
| User salt (for commitments) | — | — | — | ✅ | Lives with profile; delete breaks linkability. |
| FHE client keys (secret key material) | — | — | — | ✅ | Stored as encrypted secrets + wrappers. |

**Document metadata** (`documentType`, `issuerCountry`) is stored directly on `identity_verifications` for operational use. Full PII lives only in the profile vault. It also exists in:

- **Profile vault** — credential-encrypted, for OAuth identity claims (`identity.document` scope)
- **Signed OCR claims** — integrity-protected attestation (`ocr_result` signed claim)

### NFC Chip Claims

| Data / Claim | ZK | FHE | Commit | Vault | Notes |
|---|---|---|---|---|---|
| Chip verified | — | — | — | — | Boolean flag from ZKPassport proof verification (`proof:chip` scope). |
| Chip verification method | — | — | — | — | `"nfc_chip"` — discriminator on `identity_verifications.method`. |

### Auth & System

| Data | ZK | FHE | Commit | Vault | Notes |
|---|---|---|---|---|---|
| Passkey credential metadata | — | — | — | — | Stored in the `passkey` table for WebAuthn verification. |
| OPAQUE registration record | — | — | — | — | Stored in the `account` table; not a password hash and not plaintext. |
| Wallet address | — | — | — | — | Stored in the `wallet_address` table for wallet-based auth. |
| Raw images / biometrics | — | — | — | — | Never stored; transient only. |

### Re-verification Tracking

| Data | ZK | FHE | Commit | Vault | Notes |
|---|---|---|---|---|---|
| Last verified at | — | — | — | — | **NEW**: Timestamp of last verification. |
| Next verification due | — | — | — | — | **NEW**: Scheduled re-verification date. |
| Verification count | — | — | — | — | **NEW**: Number of verifications performed. |

**Note:** Passkey credential metadata (public keys, counters, transports) is stored in the `passkey` table for authentication and key custody. Wallet addresses are stored in the `wallet_address` table for wallet-based authentication.

---

## Storage Boundaries

This system intentionally splits data across **server storage** and **client‑only access** suggesting "vault" does **not** mean "local‑only." The vault is **stored server‑side in encrypted form**, but only the user can decrypt it using their passkey, OPAQUE export key, or wallet signature.

### Summary view

| Location | What lives there | Access & encryption | Why |
|---|---|---|---|
| **Server DB (plaintext)** | Account email, auth metadata (passkey public keys, wallet addresses), OPAQUE registration records, OAuth operational metadata (client/consent/token records), PAR request objects (`haip_pushed_request`), OID4VP session state (`haip_vp_session`), status fields | Server readable | Required for basic UX, auth, and workflow state |
| **Server DB (encrypted)** | Passkey‑sealed profile, passkey/OPAQUE/wallet‑wrapped FHE keys, FHE ciphertexts, JWKS private keys (AES-256-GCM envelope via `KEY_ENCRYPTION_KEY`, format `{"v":1,"iv":"...","ct":"..."}`) | Client‑decrypt only for user secrets (PRF‑, OPAQUE‑, or wallet‑derived keys); server‑decrypt for JWKS (server‑held KEK) | User‑controlled privacy + encrypted computation + key-at-rest protection |
| **Server DB (non‑reversible)** | Commitments, proof hashes, evidence pack hashes | Irreversible hashes | Auditability, dedup, integrity checks |
| **Client memory (ephemeral)** | Plaintext profile data, decrypted secrets, OCR previews | In‑memory only, cleared after session | Prevent persistent PII exposure |
| **On‑chain (optional)** | Encrypted attestations + public metadata | User‑decrypt only | Auditable compliance checks without PII |

### Why some data exists in two forms

- **Commitment + vault plaintext** is intentional: the server can **verify/dedup** using commitments, while the user retains **full control** of disclosure via the passkey vault.
- **Encrypted secrets + wrappers** live in the DB for **multi‑device access**, but the **decrypting key never leaves the user’s authenticator**.

### What "vault" means here

The vault is **not** a separate storage system. It is a **server‑stored encrypted blob** (`encrypted_secrets` + `secret_wrappers`) that can **only be decrypted client‑side** after WebAuthn + PRF, OPAQUE export‑key derivation, or wallet signature + HKDF derivation.

---

## Privacy Guarantees

1. **Transient media** - document and selfie images are processed in memory and discarded.
2. **No plaintext PII at rest** - sensitive attributes live only in the passkey-sealed profile or as ciphertext.
3. **One-way commitments** - hash commitments allow integrity checks without storing values.
4. **Client-side proving** - private inputs remain in the browser during ZK proof generation.
5. **User-controlled erasure** - deleting the passkey-sealed profile breaks access to PII and salts.
6. **No biometric storage** - liveness and face match scores are stored as signed claims, not raw biometrics.
7. **DPoP token binding** - access tokens bound to client's ephemeral key pair, preventing replay of stolen tokens.
8. **PAR prevents parameter leakage** - authorization parameters submitted server-side, not in browser URLs.
9. **JARM encrypted VP responses** - presentation responses encrypted to verifier's key, visible only to intended recipient.
10. **Pairwise subject identifiers** - DCR clients default to `subject_type: "pairwise"`, preventing cross-RP user correlation.
11. **Transient OAuth linkage (ARCOM)** - consent records deleted after code issuance for pairwise proof-only flows; access token DB records deleted after JWT issuance; session IP/UA metadata scrubbed. See [ADR-0001](adr/0001-arcom-double-anonymity.md).
12. **Consent HMAC integrity** - consent scope lists are HMAC-tagged; any DB-level scope widening is detected and the consent is invalidated.
13. **FHE ciphertext integrity binding** - every FHE ciphertext is HMAC-bound to its owner and attribute type; ciphertext swap attacks are detected before use.
14. **Sybil HMAC deduplication** - same identity document always produces the same `dedup_key` via `HMAC-SHA256(DEDUP_HMAC_SECRET, docNumber+issuerCountry+dob)`, enforcing one-verification-per-document across accounts without storing PII.
15. **FHE public key fingerprint** - SHA-256 fingerprint computed client-side at keygen, verified on every key load; prevents server-side key substitution. See [Tamper Model](tamper-model.md#fhe-public-key-substitution).
16. **Client-computed blob hash** - secret blob integrity hash computed client-side before upload, cross-validated against server record; prevents coordinated blob+hash replacement. See [Tamper Model](tamper-model.md#secret-blob-integrity).

## Attestation Schema

### Entity Relationship Diagram

```mermaid
erDiagram
  direction LR

  %% ── Auth & credentials ──
  USERS ||--o{ PASSKEY : registers
  USERS ||--o{ WALLET_ADDRESS : links
  USERS ||--o{ MEMBERS : joins

  %% ── Key custody ──
  USERS ||--o{ ENCRYPTED_SECRETS : owns
  ENCRYPTED_SECRETS ||--o{ SECRET_WRAPPERS : wrapped_by
  PASSKEY ||--o{ SECRET_WRAPPERS : unlocks

  %% ── Identity verification ──
  USERS ||--|| IDENTITY_BUNDLES : owns
  USERS ||--o{ IDENTITY_VERIFICATIONS : submits
  USERS ||--o{ ENCRYPTED_ATTRIBUTES : stores
  IDENTITY_VERIFICATIONS ||--o{ ZK_PROOFS : proves
  IDENTITY_VERIFICATIONS ||--o{ SIGNED_CLAIMS : attests
  IDENTITY_VERIFICATIONS ||--o{ ATTESTATION_EVIDENCE : evidences
  IDENTITY_VERIFICATIONS ||--o{ IDENTITY_VERIFICATION_DRAFTS : drafts
  USERS ||--o{ IDENTITY_VERIFICATION_DRAFTS : owns
  IDENTITY_VERIFICATION_DRAFTS ||--o{ IDENTITY_VERIFICATION_JOBS : spawns

  %% ── Organizations & RP admin ──
  ORGANIZATIONS ||--o{ MEMBERS : has_members
  ORGANIZATIONS ||--o{ INVITATIONS : sends
  ORGANIZATIONS ||--o{ OAUTH_CLIENT : owns_via_ref

  %% ── OAuth provider ──
  OAUTH_CLIENT ||--o{ OAUTH_ACCESS_TOKEN : issues
  OAUTH_CLIENT ||--o{ OAUTH_REFRESH_TOKEN : issues
  OAUTH_CLIENT ||--o{ OAUTH_CONSENT : requests
  OAUTH_CLIENT ||--o{ OAUTH_IDENTITY_DATA : receives_pii
  OAUTH_CLIENT ||--o{ RP_ENCRYPTION_KEYS : registers
  USERS ||--o{ OAUTH_ACCESS_TOKEN : authorizes
  USERS ||--o{ OAUTH_REFRESH_TOKEN : authorizes
  USERS ||--o{ OAUTH_CONSENT : grants
  USERS ||--o{ OAUTH_IDENTITY_DATA : consents_to

  %% ── HAIP compliance ──
  OAUTH_CLIENT ||--o{ HAIP_PUSHED_REQUEST : par_requests
  HAIP_VP_SESSION ||--|| OAUTH_CLIENT : belongs_to

  %% ── Web3 & credentials ──
  USERS ||--o{ BLOCKCHAIN_ATTESTATIONS : attests
  USERS ||--o{ OIDC4VCI_OFFERS : receives
  USERS ||--o{ OIDC4VCI_ISSUED_CREDENTIALS : holds

  %% ── Entity definitions ──

  USERS {
    text id PK "Account ID"
    text email "Optional"
  }

  PASSKEY {
    text id PK
    text userId FK
    text credentialID "WebAuthn credential"
  }
  WALLET_ADDRESS {
    text user_id FK
    text address "Ethereum address"
  }

  ORGANIZATIONS {
    text id PK
    text name
    text slug UK "URL-safe identifier"
  }
  MEMBERS {
    text id PK
    text organizationId FK
    text userId FK
    text role "owner | admin | member"
  }
  INVITATIONS {
    text id PK
    text organizationId FK
    text email
    text status "pending | accepted | rejected"
  }

  IDENTITY_BUNDLES {
    text user_id PK "One per user"
    text wallet_address "Optional wallet association"
    text status "pending | verified | revoked"
    text fhe_key_id "FHE service key reference"
    text fhe_status "pending | encrypting | complete | error"
    text dob_commitment "SHA256(dob + salt)"
    text address_commitment "SHA256(address + salt)"
    integer address_country_code "Plaintext country code"
    text pep_screening_result "Boolean result"
    text sanctions_screening_result "Boolean result"
    text risk_level "low | medium | high | critical"
    integer risk_score "0-100 (plaintext)"
    integer last_verified_at
    integer next_verification_due
    integer verification_count
    integer revoked_at "Revocation timestamp"
    text revoked_by "admin | self"
    text revoked_reason "Reason for revocation"
  }
  IDENTITY_VERIFICATIONS {
    text id PK
    text user_id FK
    text method "ocr | nfc_chip"
    text status "pending | verified | failed | revoked"
    text document_type "passport | id_card | etc."
    text issuer_country "ISO alpha-3"
    text document_hash "SHA-256 of document"
    text name_commitment "SHA256(name + salt)"
    text dob_commitment "SHA256(dob + salt)"
    text nationality_commitment "SHA256(nationality + salt)"
    text address_commitment "SHA256(address + salt)"
    integer address_country_code "Plaintext country code"
    real confidence_score "OCR confidence"
    real liveness_score "1.0 for NFC chip"
    integer birth_year_offset "u8 0-255 for on-chain attestation"
    text dedup_key "HMAC-SHA256 sybil dedup (OCR only, unique)"
    text unique_identifier "ZKPassport nullifier (NFC only)"
    integer verified_at
    integer revoked_at "Revocation timestamp"
    text revoked_by "admin | self"
    text revoked_reason "Reason for revocation"
  }
  IDENTITY_VERIFICATION_DRAFTS {
    text id PK
    text verification_id FK
  }
  IDENTITY_VERIFICATION_JOBS {
    text id PK
    text draft_id FK
  }

  ZK_PROOFS {
    text id PK
    text verification_id FK "age, doc_validity, etc."
  }
  SIGNED_CLAIMS {
    text id PK
    text verification_id FK "liveness, face_match, ocr"
  }
  ATTESTATION_EVIDENCE {
    text id PK
    text verification_id FK "policy_hash + proof_set_hash"
  }

  ENCRYPTED_ATTRIBUTES {
    text id PK
    text attribute_type "dob_days, liveness_score, etc."
    text ciphertext_hash "HMAC-SHA256 integrity tag"
  }
  ENCRYPTED_SECRETS {
    text id PK
    text secret_type "fhe_keys, profile_v1"
  }
  SECRET_WRAPPERS {
    text id PK
    text secret_id FK
    text credential_id "Which passkey/wallet/opaque wraps this"
  }

  OAUTH_CLIENT {
    text client_id PK
    text user_id FK "Legacy individual ownership"
    text referenceId "Organization ownership"
  }
  OAUTH_ACCESS_TOKEN {
    text id PK
    text client_id FK
    text user_id FK
  }
  OAUTH_REFRESH_TOKEN {
    text id PK
    text client_id FK
    text user_id FK
  }
  OAUTH_CONSENT {
    text id PK
    text client_id FK
    text user_id FK
    text scope_hmac "HMAC-SHA256 scope integrity tag"
  }
  OAUTH_IDENTITY_DATA {
    text id PK
    text userId FK "Unique per (user, client)"
    text clientId FK
    blob encryptedBlob "AES-256-GCM, HKDF-bound"
    text consentedScopes "JSON array"
  }
  RP_ENCRYPTION_KEYS {
    text id PK
    text clientId FK
    text algorithm "ml-kem-768"
    text status "active | rotated | revoked"
  }

  BLOCKCHAIN_ATTESTATIONS {
    text id PK
    text network_id "Chain ID"
  }
  OIDC4VCI_OFFERS {
    text id PK
    text user_id FK
    text credentials_to_issue
    text expires_at
  }
  OIDC4VCI_ISSUED_CREDENTIALS {
    text id PK
    text user_id FK
    text credential_type
    text status "active | revoked"
  }
  JWKS {
    text id PK "kid — key identifier"
    text public_key "JWK JSON (Ed25519) or custom JSON (ML-DSA-65)"
    text private_key "JWK JSON or raw keying material (AES-256-GCM envelope if KEY_ENCRYPTION_KEY set)"
    text alg "EdDSA | ML-DSA-65 | RS256 | ES256 | ECDH-ES"
    text crv "Ed25519 | P-256 | null"
    integer expiresAt "Key expiry (e.g. 90d for JARM ECDH-ES)"
  }

  HAIP_PUSHED_REQUEST {
    text id PK
    text request_id UK
    text client_id FK
    text request_params
    text resource "RFC 8707 audience"
    integer expires_at
  }
  HAIP_VP_SESSION {
    text id PK
    text session_id UK
    text nonce UK
    text state
    text dcql_query
    text response_uri
    text client_id_scheme
    text response_mode
    integer expires_at
  }

  RECOVERY_KEY_PINS {
    text id PK
    text user_id FK "Unique per user"
    text key_fingerprint "SHA-256 of ML-KEM public key"
    integer created_at
  }

  CIBA_REQUESTS {
    text id PK
    text user_id FK
    text client_id FK
    text scope
    text binding_message
    text authorization_details "JSON — RFC 9396 structured action metadata"
    text acr_values "Required assurance tier"
    text resource "RFC 8707 audience"
    text status "pending | approved | rejected | expired"
    text delivery_mode "poll | ping | push"
    text agent_claims "JSON — self-declared agent identity metadata"
    text approval_method "boundary | manual — how the request was approved"
    integer expires_at
    integer last_polled_at
  }

  AGENT_BOUNDARIES {
    text id PK
    text user_id FK
    text client_id FK
    text boundary_type "purchase | scope | custom"
    text config "JSON — limits, allowlists, cooldowns"
    integer enabled "Boolean — active or disabled"
    integer created_at
    integer updated_at
  }

  PUSH_SUBSCRIPTIONS {
    text id PK
    text user_id FK
    text endpoint UK "Web push endpoint URL"
    text p256dh "ECDH P-256 public key"
    text auth "Auth secret"
    integer created_at
  }

  %% ── FPA / CIBA auth challenge ──
  OAUTH_CLIENT ||--o{ AUTH_CHALLENGE_SESSION : challenges
  USERS ||--o{ AUTH_CHALLENGE_SESSION : authenticates

  AUTH_CHALLENGE_SESSION {
    text id PK
    text auth_session UK
    text client_id FK
    text user_id FK
    text state "pending | authenticated | code_issued"
    text challenge_type "opaque | eip712 | redirect_to_web"
  }

  %% ── FROST recovery ──
  USERS ||--o{ RECOVERY_CONFIGS : configures
  RECOVERY_CONFIGS ||--o{ RECOVERY_CHALLENGES : triggers
  RECOVERY_CONFIGS ||--o{ RECOVERY_GUARDIANS : enrolls
  RECOVERY_CHALLENGES ||--o{ RECOVERY_GUARDIAN_APPROVALS : collects
  RECOVERY_GUARDIANS ||--o{ RECOVERY_GUARDIAN_APPROVALS : approves
  USERS ||--o{ RECOVERY_SECRET_WRAPPERS : wraps
  USERS ||--o{ RECOVERY_IDENTIFIERS : identifies

  RECOVERY_CONFIGS {
    text id PK
    text user_id FK
    integer threshold
    text frost_group_pubkey
    text status "active | revoked"
  }
  RECOVERY_CHALLENGES {
    text id PK
    text user_id FK
    text recovery_config_id FK
    text status "pending | completed | applied"
  }
  RECOVERY_GUARDIANS {
    text id PK
    text recovery_config_id FK
    text guardian_type "email | custodial"
    integer participant_index
  }
  RECOVERY_GUARDIAN_APPROVALS {
    text id PK
    text challenge_id FK
    text guardian_id FK
  }
  RECOVERY_SECRET_WRAPPERS {
    text id PK
    text user_id FK
    text secret_id UK
  }
  RECOVERY_IDENTIFIERS {
    text id PK
    text user_id FK
    text recovery_id UK
  }
  FROST_SIGNER_PINS {
    text id PK
    text signer_endpoint UK
    text identity_pubkey
  }

  %% ── Recovery key pinning ──
  USERS ||--o| RECOVERY_KEY_PINS : pins

  %% ── CIBA requests ──
  USERS ||--o{ CIBA_REQUESTS : receives
  OAUTH_CLIENT ||--o{ CIBA_REQUESTS : initiates

  %% ── Push subscriptions ──
  USERS ||--o{ PUSH_SUBSCRIPTIONS : subscribes

  %% ── Agent boundaries ──
  USERS ||--o{ AGENT_BOUNDARIES : configures
  OAUTH_CLIENT ||--o{ AGENT_BOUNDARIES : scoped_to
```

### Core tables

SQLite is accessed via the libSQL client (Turso optional for hosted environments). The ER diagram above is the canonical overview of core tables and relationships. For readability, some user_id relationships are implied but not drawn (e.g., proofs and claims are also user-scoped).

---

## Evidence Pack

The evidence pack binds **policy + proof set** into a durable, auditable commitment.

- **`policy_hash`**: hash of the active compliance policy inputs (age threshold, liveness thresholds, nationality group, etc.)
- **`proof_hash`**: hash of each proof payload + public inputs + policy version
- **`proof_set_hash`**: hash of sorted `proof_hashes` + `policy_hash`
- **`consent_receipt`**: JSON consent receipt (RP + scope + timestamps)
- **`consent_receipt_hash`**: hash of the receipt (computed when building disclosure payloads)
- **`consent_scope`**: explicit fields the user approved for disclosure

Hash composition and canonicalization rules are described in the evidence bundle RFC. See [RFC: verification UX evidence bundle](rfcs/0013-verification-ux-evidence-bundle.md).

**Where it appears:**

- Stored in `attestation_evidence`
- Included in disclosure payloads
- Suitable for on-chain attestation metadata

This enables auditors and relying parties to validate **exactly which proofs** and **which policy** were used.

---

## Compliance Derivation

Compliance status is computed by a single pure function — the sole source of truth for a user's assurance level. It evaluates ZK proofs, signed claims, encrypted attributes, and sybil-resistance signals to produce a graduated tier:

| Level | Meaning |
|-------|---------|
| `none` | Unverified or fewer than half of checks passed |
| `basic` | At least half of 7 checks passed |
| `full` | All 7 checks passed (OCR path) |
| `chip` | NFC chip path with sybil resistance |

A user is considered `verified` only at `full` or `chip`.

The function evaluates 7 boolean checks covering document validity, liveness, age, face match, nationality, identity binding, and sybil resistance. Each check has different evidence sources depending on the verification method (OCR vs NFC chip). For the NFC chip path, only claim type presence matters — boolean payloads are ignored, making compliance tamper-resistant against DB manipulation.

---

## Multi-Document Model

- Users can register **multiple documents** (passport, ID, license) via OCR or NFC chip.
- Every proof and evidence pack is **verification-scoped** (`verification_id`).
- The **bundle status** is derived from the selected/most trusted verification.

This supports upgrades and re-verification without overwriting previous evidence.

---

## Web3 Attestation Schema

Encrypted attributes are stored on‑chain in the IdentityRegistry (fhEVM), including **birth year offset** (`birthYearOffset`, u8 0–255), **compliance level**, and optional flags.
Public metadata includes **proofSetHash**, **policyHash**, **issuerId**, and timestamps for auditability.

The encrypted attributes allow compliance checks **under encryption**. The public metadata enables audits without revealing PII. See [Web3 Architecture](web3-architecture.md) for the implementation details.

---

## Disclosure Payload

A relying party receives:

- Proof payloads + public inputs (for verification)
- Commitments (document hash, name commitment)
- Encrypted attributes (if required for encrypted checks)
- Evidence pack (`policy_hash`, `proof_set_hash`)
- Signed claims (liveness / face match scores)

**Consent model:** PII disclosure is **user‑authorized**. The client decrypts the passkey‑sealed profile and re‑encrypts to the RP. Zentity never handles plaintext PII.

This enables a bank or exchange to:

- Verify all ZK proofs independently
- Store an immutable audit trail
- Enforce compliance without handling raw PII

---

## Verifiable Credential Issuance

Zentity issues SD-JWT verifiable credentials containing **derived claims only**:

- `verification_level` (`none` | `basic` | `full` | `chip`)
- `verified`, `document_verified`, `liveness_verified`, `face_match_verified`
- `age_verified`, `nationality_verified`, `identity_bound`, `sybil_resistant`
- `policy_version`, `issuer_id`, `verification_time`

**No raw PII** is included in credentials. Claims derive from existing verification artifacts (ZK proofs, signed claims, FHE).

### Credential tables

- `oidc4vci_offers`: Pre-authorized credential offers (short-lived). Supports deferred issuance for credentials requiring asynchronous verification.
- `oidc4vci_issued_credentials`: Issued credential metadata + status. Includes `statusListId` + `statusListIndex` for revocation tracking via Status List 2021.
- `jwks`: Signing and encryption key material (EdDSA, ML-DSA-65, RS256, ES256, ECDH-ES). Keys are generated on first use; public keys served via `/api/auth/oauth2/jwks`.

### Selective disclosure

SD-JWT format allows users to reveal only specific claims during presentation. The holder controls which disclosure keys are included.

Verifiers validate KB-JWT holder binding: issuer signature → disclosure decode → `cnf.jkt` thumbprint match → KB-JWT signature → audience/nonce/freshness check. See [SSI Architecture](ssi-architecture.md) for the full credential model.

---

## Why This Matters for Banks & Exchanges

- **Auditability**: Evidence pack + signed claims provide durable proof of what was verified.
- **Regulatory alignment**: They can store only what is required (proofs + signed claims), not full biometrics.
- **Privacy-by-design**: Encrypted attributes allow re-checks without re-collecting data.
- **Upgrade paths**: Multi-document model and policy hashing support future policy changes.

---

## Implementation Notes

- **FHE keys** are generated in the browser and stored server‑side as credential‑wrapped encrypted secrets (no plaintext at rest).
- **Key‑wrapped storage** uses `encrypted_secrets` + `secret_wrappers` for multi‑credential access. The `kek_source` field indicates the wrapping method (`prf`, `opaque`, or `wallet`).
