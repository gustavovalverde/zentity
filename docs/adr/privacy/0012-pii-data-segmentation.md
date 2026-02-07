# ADR-0012: PII Data Segmentation

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Created** | 2026-02-06 |
| **Author** | Gustavo Valverde |

## Context

After identity verification (document OCR), extracted PII (name, DOB, document number, nationality, document type, issuing country) must be stored somewhere for:

1. **Dashboard display** — showing the user their own name
2. **OAuth identity claims** — sharing PII with relying parties via `identity.*` scopes
3. **Audit integrity** — proving what was verified without exposing raw data

Previously, `documentType` and `issuerCountry` were stored as plaintext columns in the permanent `identity_documents` table. This created unnecessary plaintext at rest in a table designed for cryptographic artifacts (hashes, commitments, proofs).

Similarly, `country_code` was FHE-encrypted, but nationality is static — it doesn't change between verifications, making FHE (designed for re-evaluation of changing data) the wrong tool.

## Decision

### 1. Profile secret as the PII source of truth

All extracted PII is stored in a credential-encrypted profile secret (`profile_v1`) immediately after document OCR. The credential material (passkey PRF, OPAQUE export key, or wallet signature) is cached from the FHE enrollment step that precedes verification.

The profile secret contains: `fullName`, `firstName`, `lastName`, `dateOfBirth`, `documentNumber`, `documentType`, `documentOrigin`, `nationality`, `nationalityCode`, `userSalt`.

### 2. Remove plaintext metadata from identity_documents

The `identity_documents` table stores only cryptographic artifacts: `documentHash`, `nameCommitment`, `confidenceScore`, `verifiedAt`, `status`. No `documentType` or `issuerCountry`.

Document metadata lives in three places, each with a clear purpose:

| Location | Data | Purpose | Lifetime |
|----------|------|---------|----------|
| **Profile vault** | All PII fields | User-controlled OAuth disclosure | Permanent (until user deletes) |
| **Signed OCR claims** | `documentType`, `issuerCountry` | Integrity-protected attestation | Permanent (immutable) |
| **Verification drafts** | `documentType`, `issuerCountry` | Claim creation during finalization | Transient (replaced on re-verification) |

### 3. Remove country_code from FHE encryption

Nationality is a binary set membership check (e.g., "EU citizen?") — proven once via ZK and stored in the profile vault for OAuth. There's no variable threshold or time-dependent derivation.

FHE is reserved for attributes that require **server-side threshold computation without user participation**:

- `dob_days` — Age = `today - dob_days` is time-dependent and threshold-variable (18+ for wine, 21+ for gambling, 25+ for car rental). FHE lets the server recompute for any RP and threshold on the ciphertext without user presence.
- `liveness_score` — Different RPs may require different minimum scores. FHE allows threshold checks (`score >= min`) without revealing the exact value.

### 4. Consent-time profile unlock

When an RP requests `identity.*` scopes, the consent UI eagerly attempts to decrypt the profile vault. If the vault can't be unlocked:

- **Required identity scopes** → consent is blocked; user must unlock
- **Optional identity scopes** → consent is allowed with a warning; PII won't be shared

This prevents silent failures where an RP receives an access token with `identity.name` scope but userinfo returns empty claims.

### 5. Verification data is in-memory only

During identity verification, extracted PII (name, DOB, document image, nationality) exists only in JavaScript memory. No `sessionStorage`, `localStorage`, or URL params. If the user refreshes the browser, the state is lost and they restart from the document step.

This is intentional: verification is an atomic, single-session process. The flow (document upload → liveness → face match → ZK proofs) must complete end-to-end without interruption. The profile secret (created after OCR) is the durable, credential-encrypted store — not browser storage.

## Consequences

- **Dashboard name display** works via the profile vault cache (populated after OCR); a short greeting name is cached in `sessionStorage` for post-verification refreshes
- **OAuth identity claims** flow: profile vault → consent UI decryption → per-RP server encryption → userinfo response
- **No plaintext PII at rest** — not in permanent identity tables, not in `sessionStorage`, not in `localStorage`
- **FHE encryption is simpler** — only two core attributes (`dob_days`, `liveness_score`)
- **Schema migration** — `identity_documents` loses two columns; existing data in drafts/signed claims is unaffected
- **Verification refresh = restart** — users must complete verification without refreshing; all transient data is in-memory only

## Related

- [ADR-0003: Passkey-Sealed Profile](0003-passkey-sealed-profile.md)
- [ADR-0004: Consent-Based Disclosure](0004-consent-based-disclosure.md)
- [ADR-0011: Selective Disclosure Scope Architecture](0011-selective-disclosure-scope-architecture.md)
- [Attestation & Privacy Architecture](../../attestation-privacy-architecture.md)
