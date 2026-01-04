# Attestation & Privacy Architecture (Web2 + Web3)

> **Related docs:** [System Architecture](architecture.md) | [ZK Architecture](zk-architecture.md) | [Web3 Architecture](web3-architecture.md) | [Tamper Model](tamper-model.md) | [README](../README.md)
>
> **Purpose**: Single source of truth for attestation schema, data classification, and privacy boundaries.

## Executive Summary

Zentity separates **eligibility proofs (ZK)**, **sensitive attributes (FHE)**, and **audit metadata (hashes + signatures)** so banks, exchanges, and Web3 protocols can verify compliance **without receiving raw PII**.

- **ZK proofs**: age, document validity, nationality membership, face match threshold.
- **FHE encryption**: birth year offset, country code, compliance level, liveness score.
- **Commitments + hashes**: document hash, name commitment, proof hashes.
- **Evidence pack**: `policy_hash` + `proof_set_hash` for durable auditability.
- **User-only decryption**: client keys are stored server-side as passkey-wrapped encrypted secrets—only the user with their passkey can unwrap them in the browser.

This model supports **multi-document identities**, **revocable attestations**, and **auditable disclosures** across Web2 and Web3.

---

## Trust & Privacy Boundaries

### Core trust model

- **Browser is untrusted for integrity** (users can tamper with client code).
- **Browser is best for privacy** (ZK proofs + client key ownership).
- **Server is trusted for integrity** (verification, signing, policy enforcement).
- **Server is not trusted for plaintext access** (only commitments + ciphertext).

### Encryption boundaries

| Layer | What happens | Who can decrypt | Why |
|---|---|---|---|
| **Web2 (off-chain)** | TFHE encryption via FHE service using client public key | **User only** (client key in browser) | Server can compute on ciphertext without decryption. |
| **Web3 (on-chain)** | FHEVM encryption in browser via SDK | **User only** (wallet signature auth) | On-chain compliance checks operate on ciphertext. |

**Important**: The server persists **encrypted key bundles** (passkey-wrapped) and registers **public + server keys** with the FHE service under a `key_id`. Client keys are only decryptable in the browser.

### Integrity controls

- All ZK proofs include a **server-issued nonce** (replay protection).
- Proofs are **verified server-side** (or on-chain in Web3 flows).
- High-risk measurements (OCR results, liveness, face match) are **server-signed claims**.
- Proofs are **bound to a claim hash** to prevent client tampering.

---

## Data Classification (ZK vs FHE vs Commitments)

| Data / Claim | ZK Proof | FHE Encrypt | Commitment / Hash | Rationale |
|---|---|---|---|---|
| Age >= threshold | ✅ | Optional | Proof hash | Eligibility fact; no need to store DOB. |
| Document validity | ✅ | ❌ | Proof hash | Binary eligibility, no expiry disclosure. |
| Nationality in allowlist | ✅ | Optional | Merkle root | Membership proof avoids country disclosure. |
| Face match >= threshold | ✅ | ❌ | Proof hash | Share only pass/fail. |
| Liveness score | ❌ | ✅ | **Signed claim** | Score should stay private; server attests. |
| Compliance level | ❌ | ✅ | **Signed claim** | Used for dynamic policy gating. |
| Birth year offset | Optional | ✅ | None | Enables on-chain compliance checks. |
| Country code (numeric) | Optional | ✅ | None | Enables on-chain allowlist checks. |
| Name (full name) | ❌ | ❌ | ✅ | Commitment enables dedup + audit. |
| Raw images / biometrics | ❌ | ❌ | ❌ | Never stored; transient only. |

**Note:** The current PoC does **not** store plaintext birth year offset—only encrypted attributes and claim hashes.

---

## Attestation Schema (Web2 - Off-Chain)

### Core tables (SQLite)

SQLite is accessed via the libSQL client (Turso optional for hosted environments).

**`identity_bundles`** (user-level)

- `status`: pending | verified | revoked
- `policy_version`, `issuer_id`
- FHE key registration status (key id, status, error state)

**`identity_documents`** (per document)

- `document_hash`, `name_commitment`
- `issuer_country`, `document_type`
- `verified_at`, `confidence_score`, `status`

**`zk_proofs`**

- `proof_type`: age_verification | doc_validity | nationality_membership | face_match
- `proof_hash`, `public_inputs`, `nonce`, `policy_version`
- Proof metadata (circuit hash, verifier version)

**`encrypted_attributes`**

- `attribute_type`: birth_year_offset | country_code | compliance_level | liveness_score
- `ciphertext`, `key_id`, `encryption_time_ms`

**`signed_claims`**

- `claim_type`: ocr_result | face_match_score | liveness_score
- `claim_payload`, `signature`, `issued_at` (scores + metadata; no raw PII fields)

**`attestation_evidence`**

- `policy_version`, `policy_hash`, `proof_set_hash`
- `consent_receipt`, `consent_scope`, `consented_at`, `consent_rp_id`
- Unique per `(user_id, document_id)`

**`blockchain_attestations`**

- On-chain status, network id, tx metadata

---

## Evidence Pack (Audit Commitment)

The evidence pack binds **policy + proof set** into a durable, auditable commitment.

- **`policy_hash`**: hash of the active compliance policy inputs (age threshold, liveness thresholds, nationality group, etc.)
- **`proof_hash`**: hash of each proof payload + public inputs + policy version
- **`proof_set_hash`**: hash of sorted `proof_hashes` + `policy_hash`
- **`consent_receipt`**: JSON consent receipt (RP + scope + timestamps)
- **`consent_receipt_hash`**: hash of the receipt (computed when building disclosure payloads)
- **`consent_scope`**: explicit fields the user approved for disclosure

Canonical form (current implementation):

```text
proof_hash = SHA256(proof_bytes || JSON.stringify(public_inputs) || policy_version)
proof_set_hash = SHA256(JSON.stringify(sorted(proof_hashes)) || policy_hash)
```

**Where it appears:**

- Stored in `attestation_evidence`
- Included in disclosure payloads
- Suitable for on-chain attestation metadata

This enables auditors and relying parties to validate **exactly which proofs** and **which policy** were used.

---

## Multi-Document Model

- Users can register **multiple documents** (passport, ID, license).
- Every proof and evidence pack is **document-scoped** (`document_id`).
- The **bundle status** is derived from the selected/most trusted document.

This supports upgrades and re-verification without overwriting previous evidence.

---

## Web3 Attestation Schema (On-Chain)

Encrypted attributes stored in `IdentityRegistry` (fhEVM):

```solidity
mapping(address => euint8)  birthYearOffset;   // years since 1900
mapping(address => euint16) countryCode;       // ISO 3166-1 numeric
mapping(address => euint8)  complianceLevel;   // 0-10
mapping(address => ebool)   isBlacklisted;     // optional
```

Public metadata for auditability:

```solidity
struct AttestationMeta {
  bytes32 proofSetHash;   // commitment to proof set
  bytes32 policyHash;     // commitment to policy version
  bytes32 issuerId;       // verifier identifier
  uint64 issuedAt;
  uint64 expiresAt;
}
```

The encrypted attributes allow compliance checks **under encryption**. The public metadata enables audits without revealing PII.

---

## Disclosure Payload (Relying Parties)

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

## Why This Matters for Banks & Exchanges

- **Auditability**: Evidence pack + signed claims provide durable proof of what was verified.
- **Regulatory alignment**: They can store only what is required (proofs + signed claims), not full biometrics.
- **Privacy-by-design**: Encrypted attributes allow re-checks without re-collecting data.
- **Upgrade paths**: Multi-document model and policy hashing support future policy changes.

---

## Implementation Notes

- **FHE keys** are generated in the browser and stored server-side as passkey-wrapped encrypted secrets (no plaintext at rest).
- **Passkey-wrapped key storage** uses a two-table design: `encrypted_secrets` (stores the encrypted data) and `secret_wrappers` (stores per-passkey DEK wrappers for multi-passkey access). See `docs/rfcs/0001-passkey-wrapped-fhe-keys.md` for the full design.
- **INTERNAL_SERVICE_TOKEN** should be required in production for OCR/FHE endpoints.
